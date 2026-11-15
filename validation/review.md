# Release review

This is the build session's own review, not an independent reviewer report.

## Findings corrected

- **Archive attribution:** the native premise was not supported by the actual
  corpus. The source audit and skill entry points now distinguish Heckel's web
  shader work from newly authored native adaptations.
- **Native parameter/API assumptions:** live inspection established
  `geometryCOMP`, MAT `vdat`/`pdat`, sequence uniform rows, GLSL menus and
  `loadTox`. The builder uses the observed native contracts.
- **Blank material render:** a freshly created geometry component with
  initialization disabled had its render flag off. The recipe explicitly
  enables geometry and SOP render/display flags. A fresh source build renders.
- **Cached capture:** forcing only Out TOP did not reliably refresh a MAT and
  Render TOP during multiple same-frame control changes. The helper explicitly
  cooks the producer and material before capturing.
- **Feedback test order:** hidden networks need explicit producer cooking for
  controlled fixed-input tests. The final test cooks source, history, state,
  display and output once per frame, and lets reset initialize before injecting
  a known change. Nine assertions pass, including 30/60-step decay comparisons.

The first failed captures/test reports remain in the development preparation
folder. The deliverable contains the final corrected native evidence.

## Reviewed behavior

Three source recipes compile and render in the installed host. Six parameter
changes produce distinct finite outputs. Native diagnostic and final captures
are included in the tutorials. All three `.tox` components reopen beneath a
different parent with identical embedded text DATs and valid internal references.
Fixed-time stateless outputs match exactly; feedback initialization is reviewed
separately from persistent history.

The source library has 393 preserved records with matching hashes. Archived web
scene decoding remains a research feature; its verification does not certify
those browser demos or native compatibility.

## Limits

The supplied studies cover image generation, temporal texture state and a
geometry material. Compute/POPs, live camera/audio, arbitrary incoming color
spaces, multi-camera and other platforms/builds remain project-specific work.
No frame-rate/GPU benchmark, external creative acceptance or fresh installed
skill invocation has been established. Validation evidence names these scopes
instead of turning one passing layer into a broader claim.
