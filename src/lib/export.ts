import { exporter, midi, Settings, type model } from '@coderline/alphatab';

export function exportGuitarPro(score: model.Score): Uint8Array {
  return new exporter.Gp7Exporter().export(score, new Settings());
}

export function exportMidi(score: model.Score): Uint8Array {
  const file = new midi.MidiFile();
  file.format = midi.MidiFileFormat.MultiTrack;
  const handler = new midi.AlphaSynthMidiFileHandler(file, true);
  new midi.MidiFileGenerator(score, new Settings(), handler).generate();
  return file.toBinary();
}

/** Codifica muestras float intercaladas (estéreo) como WAV PCM de 16 bits. */
export function encodeWav(samples: Float32Array, sampleRate: number, channels = 2): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
