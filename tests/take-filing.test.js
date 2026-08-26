import { describe, test, expect } from 'vitest';
import { whereTakeGoes } from '../src/store/db.js';

// TWO TAKES OF THE SAME THING LIVE IN A FOLDER OF THAT THING.
//
// "if you save another take, then that one in the library turns into a folder
// where it shows both the takes."
//
// The rule has to hold three ways at once, and the middle one is the whole
// point: one take is a ROW (a folder holding one thing is a tap in the way of
// it), the second take MAKES the folder and takes the first in with it, and
// every take after that joins the folder that is already there.

const take = (id, name, folderId = null) => ({ id, name, ...(folderId == null ? {} : { folderId }) });

describe('where a take just saved goes', () => {
  test('the first take of a name stays a row', () => {
    const plan = whereTakeGoes({ takes: [take(1, 'Bach — Prelude')], folders: [], id: 1, name: 'Bach — Prelude' });
    expect(plan.folder).toBe(null);
    expect(plan.create).toBe(null);
    expect(plan.move).toEqual([]);
  });

  test('the second makes the folder and takes the first in with it', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'Bach — Prelude'), take(2, 'Bach — Prelude')],
      folders: [],
      id: 2,
      name: 'Bach — Prelude',
    });
    expect(plan.create).toBe('Bach — Prelude');
    // BOTH of them, which is the half a listing cannot show: a folder with the
    // new take in it and the old one still loose outside it is the same
    // complaint in a different shape.
    expect(plan.move.sort()).toEqual([1, 2]);
  });

  test('the third joins the folder that is already there, and makes nothing', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'Bach — Prelude', 7), take(2, 'Bach — Prelude', 7), take(3, 'Bach — Prelude')],
      folders: [{ id: 7, name: 'Bach — Prelude' }],
      id: 3,
      name: 'Bach — Prelude',
    });
    expect(plan.folder).toBe(7);
    expect(plan.create).toBe(null);
    expect(plan.move).toEqual([3]);   // the two already filed are left alone
  });

  test('a name that differs only in case is the same piece', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'bach — prelude'), take(2, 'Bach — Prelude')],
      folders: [],
      id: 2,
      name: 'Bach — Prelude',
    });
    expect(plan.move.sort()).toEqual([1, 2]);
  });

  test('a folder somebody already made of that name is used rather than a second one', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'Elgar'), take(2, 'Elgar')],
      folders: [{ id: 4, name: 'Elgar' }],
      id: 2,
      name: 'Elgar',
    });
    expect(plan.create).toBe(null);
    expect(plan.folder).toBe(4);
  });

  // A FOLDER MADE BY THE APP MUST NOT UNDO A FILING MADE BY A PERSON.
  test('takes filed by hand into other folders are left where they are', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'Elgar', 11), take(2, 'Elgar', 12), take(3, 'Elgar')],
      folders: [{ id: 11, name: 'Concerto' }, { id: 12, name: 'Lessons' }],
      id: 3,
      name: 'Elgar',
    });
    // No folder of that name, and nothing loose to gather but this one — it
    // joins whichever the others are in rather than starting a third.
    expect(plan.create).toBe(null);
    expect(plan.folder).toBe(11);
    expect(plan.move).toEqual([3]);
  });

  test('a take already in a folder stays in it', () => {
    const plan = whereTakeGoes({
      takes: [take(1, 'Elgar'), take(2, 'Elgar', 9)],
      folders: [],
      id: 2,
      name: 'Elgar',
    });
    expect(plan.folder).toBe(9);
    expect(plan.move).toEqual([]);
  });

  test('an unnamed take is filed nowhere', () => {
    expect(whereTakeGoes({ takes: [take(1, ''), take(2, '')], folders: [], id: 2, name: '' }).folder)
      .toBe(null);
    expect(whereTakeGoes({ takes: [take(1, 'x')], folders: [], id: 2, name: '   ' }).create)
      .toBe(null);
  });
});
