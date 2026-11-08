import { describe, it, expect } from 'vitest';
import { coursePagePath, findComposeHref, composeMessage, composeHash, readComposeHash } from '../../extension/src/teacher-email.js';

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
  it('writes as the parent, or as the student', () => {
    const base = { studentName: 'Sam Rivera', title: 'Persuasive Essay Draft', courseName: 'American Literature', dueText: 'Nov 4' };
    const p = composeMessage({ ...base, isParent: true });
    expect(p.subject).toBe('Persuasive Essay Draft (due Nov 4)');
    expect(p.body).toContain("I'm Sam's parent");
    expect(p.body).toContain('"Persuasive Essay Draft" (due Nov 4) as missing in American Literature');
    const s = composeMessage({ ...base, isParent: false });
    expect(s.body).toContain('what I need to do');
    expect(s.body).not.toContain('parent');
    expect(s.body.endsWith('Sam')).toBe(true);
  });
  it('round-trips through the URL hash, and ignores anything else', () => {
    const msg = { subject: 'Quiz & Test (due Nov 4)', body: 'Line 1\n\n"Line 2" #3' };
    expect(readComposeHash(composeHash(msg))).toEqual(msg);
    expect(readComposeHash('#something-else')).toBeNull();
    expect(readComposeHash('#sgd-compose=%7Bbroken')).toBeNull();
  });
});
