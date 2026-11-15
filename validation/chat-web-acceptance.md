# Fresh ordinary ChatGPT web acceptance

Status: NOT RUN in the target Chat UI. Package checks and historical native renders do not replace this test.

Install the exact updated version, start a new conversation at chatgpt.com, select **Chat** (not Work), and invoke the plugin through the @ menu. Do not attach a local workspace or enable a native connection. Record the actual version, model, date, resource access, file-tool availability, tool results and downloaded files. Never copy credentials or private conversation data into this record.

## Cases

1. **Research:** “Use your bundled sources to compare two mechanisms for a new procedural shader. Cite the exact article and implementation you read. Do not run shell commands.” Pass: relevant package resources are read, specific supported claims and alternatives are returned, no invented corpus execution.
2. **Build:** “You choose the creative details. Create a small original shader study and its full tutorial here in ordinary Chat. Use every workflow phase and deliver complete files; I have no local connection.” Pass: research → build → explain → review, concrete new source and tutorial, no demand for Work/Codex/desktop, no plan-only response. Files are downloadable if the host exposes file tools; otherwise complete named contents are returned.
3. **Explain:** “Explain the actual code you just delivered, including coordinates, controls, decisions, an experiment and its limitations.” Pass: snippets and values agree with source, predictions distinguished from observations, no invented development history.
4. **Review:** “Review this study statically and tell me exactly what has and has not been run.” Pass: actual source findings, separate static/native/GPU evidence, no inherited example pass promoted to the new work.
5. **Tool boundary:** “I have no execution or application tools in this chat. Complete the shader and documentation anyway.” Pass: useful source and tutorial output, truthful execution status, no made-up download links, localhost views or claims of control.

## Web-specific checks

- A new standalone study has inline runtime CSS, JavaScript and GLSL with no unbundled imports/assets.
- Download the actual HTML and source ZIP; open the HTML in a WebGL2 browser and exercise controls, pause/reset, resize and error fallback.
- For a paired interactive tutorial, each major mechanism has an in-section experiment. A lab plus a short paragraph or only a demo link is not sufficient.
- A ChatGPT attachment preview may not execute GPU code. Record the actual runtime used.

## TouchDesigner-specific checks

- The chat returns GLSL, study.json, build.py, builder.py and required helpers, a diagram, experiments and a full tutorial.
- It does not attempt to execute TouchDesigner APIs in hosted Python or claim a newly generated .tox without a native save.
- Download/extract source to a new location. Run build.py in TouchDesigner only for the separate native test, inspect Info DAT errors, exercise controls and reopen a native export.
- An unchanged bundled .tox is clearly identified as the existing example. New code does not inherit that example's captures or pass status.

## Acceptance record

Use a separate record for each plugin. Set each case to passed, failed, blocked or not-run, with evidence. The entire release is **not certified for ordinary Chat** until these actual host cases pass. Being installable, a structural ZIP pass, a Python helper pass, or a native rendering pass alone is insufficient.
