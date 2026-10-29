//! Motor de transcripción: un Python propio en la carpeta de datos de la app que se instala la
//! primera vez (engine/install.ps1) y que ejecuta engine/bandtabs_engine.py.
//!
//! Los dos procesos escriben una línea JSON por evento; cada línea se reenvía a la interfaz como
//! evento `engine-event` para mostrar el progreso.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct EngineState {
  child: Mutex<Option<Child>>,
  cancelled: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
  installed: bool,
  needs_update: bool,
  dir: String,
}

/// En Windows, Tauri puede dar rutas con el prefijo `\\?\` (p. ej. `\\?\C:\Users\…`), que
/// PowerShell no entiende: Join-Path falla con "el valor del argumento drive es NULL".
fn plain(path: PathBuf) -> PathBuf {
  let text = path.to_string_lossy();
  if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
    return PathBuf::from(format!(r"\\{rest}"));
  }
  match text.strip_prefix(r"\\?\") {
    Some(rest) => PathBuf::from(rest),
    None => path,
  }
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(plain(app.path().app_local_data_dir().map_err(|e| e.to_string())?).join("engine"))
}

fn engine_source(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(plain(app.path().resource_dir().map_err(|e| e.to_string())?).join("engine"))
}

fn python_exe(dir: &Path) -> PathBuf {
  if cfg!(windows) {
    dir.join("python").join("python.exe")
  } else {
    dir.join("python").join("bin").join("python3")
  }
}

fn hide_window(command: &mut Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(not(windows))]
  let _ = command;
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> Result<EngineStatus, String> {
  let dir = engine_dir(&app)?;
  let source = engine_source(&app)?;
  let installed = python_exe(&dir).exists() && dir.join("installed.lock").exists();
  let wanted = std::fs::read_to_string(source.join("requirements.lock")).unwrap_or_default();
  let current = std::fs::read_to_string(dir.join("installed.lock")).unwrap_or_default();
  Ok(EngineStatus {
    installed,
    needs_update: installed && wanted != current,
    dir: dir.display().to_string(),
  })
}

/// Ejecuta un proceso, reenvía cada línea JSON de stdout a la interfaz y devuelve la última
/// línea de tipo "done", o el mensaje de la última de tipo "error".
fn run_streaming(app: &AppHandle, mut command: Command) -> Result<String, String> {
  let state = app.state::<EngineState>();
  state.cancelled.store(false, Ordering::SeqCst);
  hide_window(&mut command);
  command.stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
  let mut child = command.spawn().map_err(|e| format!("No se pudo arrancar el motor: {e}"))?;
  let stdout = child.stdout.take().ok_or("sin salida estándar")?;
  let mut stderr = child.stderr.take().ok_or("sin salida de errores")?;
  *state.child.lock().unwrap() = Some(child);

  // stderr se lee en otro hilo para que no se llene el búfer y bloquee al proceso.
  let stderr_thread = std::thread::spawn(move || {
    let mut text = String::new();
    let _ = stderr.read_to_string(&mut text);
    text
  });

  let mut done: Option<String> = None;
  let mut error: Option<String> = None;
  for line in BufReader::new(stdout).lines() {
    let Ok(line) = line else { break };
    let line = line.trim().to_string();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
      continue;
    };
    match value.get("type").and_then(|t| t.as_str()) {
      Some("done") => done = Some(line.clone()),
      Some("error") => {
        error = value.get("message").and_then(|m| m.as_str()).map(str::to_string);
      }
      _ => {}
    }
    let _ = app.emit("engine-event", value);
  }

  let status = state.child.lock().unwrap().take().map(|mut c| c.wait());
  let stderr_text = stderr_thread.join().unwrap_or_default();
  if state.cancelled.load(Ordering::SeqCst) {
    return Err("Cancelado".into());
  }
  if let Some(done) = done {
    return Ok(done);
  }
  if let Some(error) = error {
    return Err(error);
  }
  match status {
    None => Err("El motor terminó sin resultado".into()),
    Some(Ok(s)) if s.success() => Err("El motor terminó sin resultado".into()),
    _ => {
      let tail: String = stderr_text.lines().rev().take(8).collect::<Vec<_>>().join("\n");
      Err(format!("El motor se detuvo con un error.\n{tail}"))
    }
  }
}

/// Los procesos tardan minutos: se ejecutan fuera del hilo de la interfaz.
async fn run_blocking(app: AppHandle, command: Command) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || run_streaming(&app, command))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn engine_install(app: AppHandle) -> Result<(), String> {
  let dir = engine_dir(&app)?;
  let source = engine_source(&app)?;
  if !cfg!(windows) {
    return Err("La instalación automática del motor solo está disponible en Windows.".into());
  }
  let mut command = Command::new("powershell");
  command
    .arg("-NoProfile")
    .arg("-ExecutionPolicy")
    .arg("Bypass")
    .arg("-File")
    .arg(source.join("install.ps1"))
    .arg("-Dir")
    .arg(&dir)
    .arg("-EngineSource")
    .arg(&source);
  run_blocking(app, command).await.map(|_| ())
}

#[tauri::command]
pub async fn engine_transcribe(
  app: AppHandle,
  source: String,
  lyrics: bool,
) -> Result<String, String> {
  let dir = engine_dir(&app)?;
  let script = engine_source(&app)?.join("bandtabs_engine.py");
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
  let work = plain(app.path().app_local_data_dir().map_err(|e| e.to_string())?)
    .join("transcriptions")
    .join(stamp.to_string());

  let python = python_exe(&dir);
  let scripts = python.parent().map(|p| p.join("Scripts")).unwrap_or_default();
  let path = std::env::var("PATH").unwrap_or_default();
  let separator = if cfg!(windows) { ";" } else { ":" };

  let mut command = Command::new(&python);
  command
    .arg(&script)
    .arg("transcribe")
    .arg("--source")
    .arg(&source)
    .arg("--work")
    .arg(&work)
    // yt-dlp necesita deno (instalado con pip en Scripts) para YouTube.
    .env("PATH", format!("{}{separator}{path}", scripts.display()))
    .env("TORCH_HOME", dir.join("models").join("torch"))
    .env("HF_HOME", dir.join("models").join("huggingface"))
    .env("PYTHONUTF8", "1")
    .env("PYTHONIOENCODING", "utf-8");
  if !lyrics {
    command.arg("--no-lyrics");
  }

  let done = run_blocking(app, command).await?;
  let value: serde_json::Value = serde_json::from_str(&done).map_err(|e| e.to_string())?;
  let result_path = value.get("result").and_then(|r| r.as_str()).ok_or("Resultado vacío")?;
  std::fs::read_to_string(result_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_cancel(state: State<'_, EngineState>) -> Result<(), String> {
  state.cancelled.store(true, Ordering::SeqCst);
  if let Some(child) = state.child.lock().unwrap().as_mut() {
    child.kill().map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::plain;
  use std::path::PathBuf;

  #[test]
  fn quita_el_prefijo_de_ruta_larga() {
    assert_eq!(
      plain(PathBuf::from(r"\\?\C:\Program Files\BandTabs")),
      PathBuf::from(r"C:\Program Files\BandTabs")
    );
    assert_eq!(plain(PathBuf::from(r"\\?\UNC\server\share")), PathBuf::from(r"\\server\share"));
    assert_eq!(plain(PathBuf::from(r"C:\x")), PathBuf::from(r"C:\x"));
  }
}
