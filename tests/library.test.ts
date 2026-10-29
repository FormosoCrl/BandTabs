import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BandTabsDb } from '../src/lib/db';
import { Library } from '../src/lib/library';
import { DEMO_ALPHATEX } from '../src/lib/demo';
import { DROP_D_TEX, encode, makeGuitarPro } from './helpers';

let db: BandTabsDb;
let library: Library;

beforeEach(() => {
  db = new BandTabsDb(`test-${Math.random()}`);
  library = new Library(db);
});

afterEach(async () => {
  await db.delete();
});

describe('Library', () => {
  it('importa varios archivos e informa de los que fallan', async () => {
    const result = await library.importFiles([
      { name: 'demo.gp', data: makeGuitarPro() },
      { name: 'dropd.atex', data: encode(DROP_D_TEX) },
      { name: 'nota.txt', data: encode('hola') },
    ]);
    expect(result.added.map((s) => s.title)).toEqual(['Riff de ejemplo', 'Drop D']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].fileName).toBe('nota.txt');
    expect(await db.files.count()).toBe(2);
  });

  it('busca ignorando acentos y filtra por instrumento y afinación', async () => {
    await library.importFile('demo.atex', encode(DEMO_ALPHATEX));
    await library.importFile('dropd.atex', encode(DROP_D_TEX));

    expect((await library.search({ query: 'nandu' })).map((s) => s.title)).toEqual(['Drop D']);
    expect((await library.search({ instrument: 'bateria' })).map((s) => s.title)).toEqual(['Drop D']);
    expect((await library.search({ instrument: 'bajo' })).map((s) => s.title)).toEqual([
      'Riff de ejemplo',
    ]);
    expect(await library.tunings()).toEqual(['Estándar', 'D A D G B E']);
    expect((await library.search({ tuning: 'D A D G B E' })).map((s) => s.title)).toEqual([
      'Drop D',
    ]);
  });

  it('marca favoritos y guarda el historial al abrir', async () => {
    const a = await library.importFile('demo.atex', encode(DEMO_ALPHATEX));
    const b = await library.importFile('dropd.atex', encode(DROP_D_TEX));
    await library.setFavorite(b.id, true);
    expect((await library.search({ favoritesOnly: true })).map((s) => s.id)).toEqual([b.id]);

    const opened = await library.open(a.id);
    expect(opened?.data).toEqual(encode(DEMO_ALPHATEX));
    expect((await library.recent()).map((s) => s.id)).toEqual([a.id]);
  });

  it('gestiona listas y limpia referencias al borrar canciones', async () => {
    const a = await library.importFile('demo.atex', encode(DEMO_ALPHATEX));
    const b = await library.importFile('dropd.atex', encode(DROP_D_TEX));
    const list = await library.createPlaylist('  Ensayo  ');
    expect(list.name).toBe('Ensayo');

    await library.addToPlaylist(list.id, b.id);
    await library.addToPlaylist(list.id, a.id);
    await library.addToPlaylist(list.id, a.id);
    expect((await library.search({ playlistId: list.id })).map((s) => s.id)).toEqual([b.id, a.id]);

    await library.remove(b.id);
    expect((await db.playlists.get(list.id))?.songIds).toEqual([a.id]);
    expect(await db.files.get(b.id)).toBeUndefined();
  });
});
