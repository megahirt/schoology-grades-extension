// phoneMetrics: where and how large to draw the panel on a phone, where
// Schoology's desktop page is laid out ~980 px wide and zoomed out.
import { describe, it, expect } from 'vitest';
import { phoneMetrics } from '../../extension/src/panel.js';

const win = ({ screen, vv, layoutW }) => ({
  screen,
  visualViewport: vv,
  document: { documentElement: { clientWidth: layoutW } },
});

describe('phoneMetrics', () => {
  it('is null on a computer', () => {
    expect(phoneMetrics(win({
      screen: { width: 1512, height: 982 },
      vv: { width: 1280, height: 720, offsetLeft: 0, offsetTop: 0 },
      layoutW: 1280,
    }))).toBeNull();
  });

  it('is null without a visual viewport', () => {
    expect(phoneMetrics({ screen: { width: 412, height: 915 }, document: { documentElement: {} } })).toBeNull();
  });

  it('scales up on a zoomed-out desktop page', () => {
    const m = phoneMetrics(win({
      screen: { width: 412, height: 915 },
      vv: { width: 980, height: 1900, offsetLeft: 0, offsetTop: 0 },
      layoutW: 980,
    }));
    expect(m.s).toBeCloseTo(980 / 412, 5);
    expect(m.w).toBeCloseTo(412, 5);
    expect(m.h).toBeCloseTo(1900 / (980 / 412), 5);
    expect(m).toMatchObject({ x: 0, y: 0, r: 0 });
  });

  it('follows pinch-zoom and panning', () => {
    const m = phoneMetrics(win({
      screen: { width: 412, height: 915 },
      vv: { width: 490, height: 950, offsetLeft: 200, offsetTop: 300 },
      layoutW: 980,
    }));
    expect(m.s).toBeCloseTo(490 / 412, 5);
    expect(m).toMatchObject({ x: 200, y: 300, r: 290 });
    expect(m.w).toBeCloseTo(412, 5);
  });

  it('is scale 1 on a page with a mobile layout', () => {
    const m = phoneMetrics(win({
      screen: { width: 412, height: 915 },
      vv: { width: 412, height: 780, offsetLeft: 0, offsetTop: 0 },
      layoutW: 412,
    }));
    expect(m).toMatchObject({ s: 1, w: 412, h: 780 });
  });

  it('counts a phone held sideways as a phone', () => {
    const m = phoneMetrics(win({
      screen: { width: 915, height: 412 },
      vv: { width: 980, height: 400, offsetLeft: 0, offsetTop: 0 },
      layoutW: 980,
    }));
    expect(m.s).toBeCloseTo(980 / 915, 5);
  });
});
