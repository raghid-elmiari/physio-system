// Scripted movement used by the "simulated input" mode: a patient doing repetitions with
// typical mistakes and corrections. Lets the whole evaluator -> feedback -> voice -> save
// chain be demonstrated and checked on a machine without a camera. Not real patient data.

import { goodRepKeyframes } from "./syntheticPose.js";

const rest = (at, extra = {}) => ({ at, leftAbduction: 12, rightAbduction: 12, ...extra });
const up = (at, extra = {}) => ({ at, leftAbduction: 88, rightAbduction: 88, ...extra });

export function demoKeyframes() {
  const kf = [rest(0), rest(2500)];
  // 1: clean repetition
  kf.push(...goodRepKeyframes(3000, { leftAbduction: 12, rightAbduction: 12 }));
  // 2: left elbow bends at the top, then is straightened (correction + confirmation)
  kf.push(rest(8500), up(10000), up(10300, { leftElbow: 120 }), up(13500, { leftElbow: 120 }), up(13900), up(15500), rest(17000), rest(17600));
  // 3: stops short of shoulder height (live "lift higher", repetition not counted)
  kf.push({ at: 19000, leftAbduction: 58, rightAbduction: 58 }, { at: 21800, leftAbduction: 60, rightAbduction: 60 }, rest(23200), rest(23800));
  // 4: leans to the side, then corrects
  kf.push(up(25300), up(25600, { trunkLean: 16 }), up(28500, { trunkLean: 16 }), up(28900), up(30500), rest(32000), rest(32600));
  // 5: steps partly out of frame (no corrections while tracking is lost), comes back
  kf.push(rest(33000, { hidden: [23, 24] }), rest(36500, { hidden: [23, 24] }), rest(36600), rest(38000));
  // 6-8: clean repetitions
  kf.push(...goodRepKeyframes(38000, { leftAbduction: 12, rightAbduction: 12 }));
  kf.push(...goodRepKeyframes(43100, { leftAbduction: 12, rightAbduction: 12 }));
  kf.push(...goodRepKeyframes(48200, { leftAbduction: 12, rightAbduction: 12 }));
  return kf;
}
