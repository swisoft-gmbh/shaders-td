# Feedback is part of the algorithm

Draw both same-frame edges and previous-frame references. The starter uses:

```text
procedural source ──────────────> state GLSL ──> display GLSL ──> out
zero seed ──> Feedback TOP ─────> state GLSL
                 ^                 |
                 └── target: state (previous frame)
```

The state texture stores R=current luma, G=decayed trail, B=raw motion,
A=initialized. The seed is all zero including alpha. On the first initialized
frame, write current luma and zero motion; don't compare the scene to black.
Keep display styling out of the feedback target so palette changes do not alter
motion detection.

The example uses `max(newMotion, oldTrail * exp(-dt / lifetime))`. This is a
new adaptation of the archive's persistence mechanism. Unlike a fixed per-frame
multiplier, its decay has an explicit time unit. `dt` is a **specified simulation
step**, not a measurement of elapsed wall time. If frames drop or cooking stops,
wall-clock persistence changes. Production input needs a deliberate timestamp
policy, clamped gaps and reset when the source jumps.

If Pause is on, the state pass returns old state. A fixed-time source with an
unpaused state still needs to decay normally. A Reset toggle passes the zero
seed and reinitializes luma. Reset after resize, seek, source replacement or a
format change; do not trust old-sized history.

Validate at least:

- First frame produces no flash.
- An unchanged image produces zero new motion.
- Moving content triggers a local mask; changing global exposure triggers a
  global change (a known limitation).
- A stopped source leaves a decaying trail at the declared step.
- Pause holds state; reset clears it; changing palette does not change it.
- Two different fixed steps yield comparable decay at the same simulated time.
- No branch reads its own current output without the explicit Feedback TOP.

For video/camera work, verify whether input timestamps update each cook. For
direction estimates, test axis signs with known motion, resolve UV orientation
and define whether output is direction, displacement per frame or velocity.
Do not call frame differencing optical flow.
