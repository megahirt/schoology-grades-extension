import { describe, it, expect } from 'vitest';
import { coursePagePath, findComposeHref, findCourseAdmins, composeUrlFor, likelyTeacher, findParentName, composeMessage, composeHash, readComposeHash } from '../../extension/src/teacher-email.js';

describe('teacher email', () => {
  it('reads the course page for the right account type', () => {
    expect(coursePagePath({ isParent: true, childUid: '2000001', courseId: '4003' })).toBe('/course/4003/preview/2000001/parent?url=course/4003/materials');
    expect(coursePagePath({ isParent: false, courseId: '4003' })).toBe('/course/4003/materials');
  });
  it('finds Schoology\'s "Message Admins" link (shape seen live)', () => {
    const html = '<h3><a href="/course/1/members" class="view-members">1 Admin</a> &sdot; <span><a href="/parent/messages/new/course/4003?recipient_uids=9001&amp;x=1" class="enrollment-members-message"><span class="message-icon"></span></a></span></h3>';
    expect(findComposeHref(html)).toBe('/parent/messages/new/course/4003?recipient_uids=9001&x=1');
    expect(findComposeHref('<p>No admins</p>')).toBeNull();
  });
  it('reads the class admins with their names (shape seen live)', () => {
    const html = '<h3><a class="view-members">3 Admins</a> &sdot; <a href="/parent/messages/new/course/4003?recipient_uids=9100%2C9301%2C9302" class="enrollment-members-message"></a></h3>' +
      "<div class='picture_block clearfix'><div class=\"picture\"><a href=\"/user/9301\" title=\"Ms. Park\"><img alt=\"Ms. Park\"></a></div>" +
      '<div class="picture"><a href="/user/9100" title="Mr. O&#039;Brien"><img></a></div></div>' +
      '<a href="/user/9302" title="View user profile.">Mr. Chen</a>';
    expect(findCourseAdmins(html)).toEqual([
      { uid: '9100', name: "Mr. O'Brien" },
      { uid: '9301', name: 'Ms. Park' },
      { uid: '9302', name: '' },
    ]);
    expect(findCourseAdmins('<p>No admins</p>')).toEqual([]);
  });
  it('addresses the message to one admin only', () => {
    expect(composeUrlFor('https://x.test/parent/messages/new/course/4003?recipient_uids=9100%2C9301%2C9302', '9301'))
      .toBe('https://x.test/parent/messages/new/course/4003?recipient_uids=9301');
    expect(composeUrlFor('/m?a=1&recipient_uids=1,2&b=2', '2')).toBe('/m?a=1&recipient_uids=2&b=2');
  });
  it('guesses the teacher: the admin on the fewest of the family\'s classes, unless tied', () => {
    const admins = [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }];
    expect(likelyTeacher(admins, { a: 12, b: 4, c: 1 })).toBe('c');
    expect(likelyTeacher(admins, { a: 12, b: 1, c: 1 })).toBeNull();
    expect(likelyTeacher([{ uid: 'x' }], {})).toBe('x');
    expect(likelyTeacher([], {})).toBeNull();
  });
  it('writes as the parent', () => {
    const base = { studentName: 'Sam Rivera', title: 'Persuasive Essay Draft', courseName: 'American Literature', dueText: 'Nov 4' };
    const p = composeMessage({ ...base, parentName: 'Pat Rivera' });
    expect(p.subject).toBe('Persuasive Essay Draft (due Nov 4) - marked missing');
    expect(p.body).not.toContain("parent");
    expect(p.body).toContain('"Persuasive Essay Draft" (due Nov 4) as missing in American Literature');
    expect(p.body).toContain('what Sam needs to do');
    expect(p.body.endsWith('Sincerely,\nPat Rivera')).toBe(true);
    expect(composeMessage(base).body.endsWith('Sincerely,')).toBe(true);
  });
  it('reads the signed-in parent\'s name from Schoology\'s page data', () => {
    expect(findParentName('{"parentUid":1,"parentName":"Pat Rivera","x":2}')).toBe('Pat Rivera');
    expect(findParentName('{"parentName":"Zo\\u00eb O\\u0027Neil"}')).toBe("Zoë O'Neil");
    expect(findParentName('<p>none</p>')).toBe('');
  });
  it('round-trips through the URL hash, and ignores anything else', () => {
    const msg = { subject: 'Quiz & Test (due Nov 4)', body: 'Line 1\n\n"Line 2" #3' };
    expect(readComposeHash(composeHash(msg))).toEqual(msg);
    expect(readComposeHash('#something-else')).toBeNull();
    expect(readComposeHash('#sgd-compose=%7Bbroken')).toBeNull();
  });
});
