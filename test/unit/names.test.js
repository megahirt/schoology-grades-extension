// names.test.js — class-name cleanup for display (extension/src/names.js).
import { describe, it, expect } from 'vitest';
import { cleanCourseNames } from '../../extension/src/names.js';

const names = (list) => cleanCourseNames(list.map((name, i) => ({ id: String(i), name }))).map((c) => c.name);

describe('cleanCourseNames', () => {
  it('drops a leading grade number', () => {
    expect(names(['07 Bible', '07 English', '07 Math', 'Orchestra'])).toEqual(['Bible', 'English', 'Math', 'Orchestra']);
  });

  it('drops a short all-caps code shared by two or more classes', () => {
    expect(names(['ABC Advisory', 'ABC American Literature', 'ABC Government', 'Band'])).toEqual(['Advisory', 'American Literature', 'Government', 'Band']);
  });

  it('keeps a code that starts only one class (part of its name)', () => {
    expect(names(['US History', 'SU Study Hall', 'Algebra 2'])).toEqual(['US History', 'SU Study Hall', 'Algebra 2']);
  });

  it('keeps all-caps names, longer words, and numbers that are not a prefix', () => {
    expect(names(['COOL CLASS', 'HONORS Band', 'HONORS Chorus', 'Algebra 2', 'House Group 1'])).toEqual(['COOL CLASS', 'HONORS Band', 'HONORS Chorus', 'Algebra 2', 'House Group 1']);
  });

  it('never empties a name, and keeps the original as fullName', () => {
    const [c] = cleanCourseNames([{ id: '1', name: '07 English' }]);
    expect(c).toMatchObject({ name: 'English', fullName: '07 English' });
    expect(names(['07'])).toEqual(['07']);
  });
});
