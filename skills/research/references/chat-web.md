# Hosts: what to deliver with the tools you have

The four skills work in any host that loads skills: chat hosts such as ChatGPT
and Claude, and coding agents such as Claude Code and Codex. Researching,
writing source, explaining it and reviewing it by reading need no shell, no
local checkout and no connection to TouchDesigner. Installing the plugin grants
no extra tools. Use the capabilities this conversation actually has.

## Contents

- [What outranks these skills](#what-outranks-these-skills)
- [Decide once from the available capabilities](#decide-once-from-the-available-capabilities)
- [Keep all four skills useful](#keep-all-four-skills-useful)
- [Evidence and acceptance](#evidence-and-acceptance)
- [TouchDesigner output](#touchdesigner-output)

## What outranks these skills

The user's explicit instructions come first, then the host's or organisation's
standing rules. Those rules decide how questions are asked, how many, when to
check in, which planning documents to keep and how to test. Where they differ
from a default in these skills, follow them.

One rule never yields: do not claim a check that did not run. No tools means no
claimed execution, native export, preview or download link.

Ask through the host's question tool when it has one, with two to four options
and the recommended one first. Use conversational questions only when the host
has no such tool. Reuse answers the user already gave.

## Decide once from the available capabilities

| Available capability | Procedure |
| --- | --- |
| Plugin resource reader, no execution | Read bundled files through the host resource interface. Return complete named source files and the tutorial in chat. |
| Hosted Python or file creation | Write files in the host's writable artifact directory, run the static checks that apply, create a ZIP and use the download links the host returns. |
| Shell in a cloud workspace | Run the portable helpers against the mounted package and a new writable output directory. This is not access to the user's computer. |
| Local shell in a coding agent | Resolve `scripts/` and `references/` against the installed skill's base directory and run the helpers from there. Write new studies to the user's project or a directory they name, never inside the installed plugin. This is the user's computer: keep commands scoped to the request. |
| TouchDesigner's MCP server (TDMCP) connected | Build, cook, read compile errors and capture through it, inside the user's TouchDesigner. See [TouchDesigner output](#touchdesigner-output). |
| Connected browser | Additionally run preview checks and capture them, labelled as previews. |

Choose from tools the host lists. Do not invent a function name, resource URI,
mounted path, localhost URL or attachment. Resolve relative references through
the same host and package the skill came from, never through a previous
author's workstation paths. Reading Markdown, JSON, GLSL or TypeScript
references needs no shell.

Start with [the compact source index](chat-source-index.md), then read the
relevant article and implementation, not the entire archive. Python search is
optional. When package resources cannot be read, say exactly what was not read.
Source the user supplies, or a live primary source they name, can support
partial progress; do not claim the archived revision was inspected.

If the plugin's `examples/` folder is missing (some installs carry only
`skills/`), keep each rule and skip its example pointer. `scaffold.py` then
says how to start from the two bundled scripts.

## Keep all four skills useful

Research returns cited mechanisms and alternatives. Build returns concrete,
complete source. Explain returns the full implementation-linked tutorial.
Review inspects supplied source and reports findings with evidence. A missing
GPU or native host limits the runtime evidence; it does not turn a request for
source and a tutorial into a plan, or into a request to change hosts.

Ask for project files only when the user wants them inspected, not for a local
installation to unlock source generation. If the user supplied a screenshot,
separate what the picture shows from facts that need code or execution.

With Python but no shell, use pathlib, json, zipfile, ast and runpy directly.
The helpers use the standard library only. Resource access does not mean the
whole package is mounted: read and materialise only the files you need, keeping
their relative structure, or write the deliverable directly.

The build helper `scripts/bundle.py` exposes
`create_bundle(study_directory, destination)` through runpy or importlib. Put
the ZIP outside the study directory and choose an unused filename. With file
creation, return the readable main artifact and the source ZIP. Without it,
return full file contents under explicit filenames; a code block is not an
attachment.

## Evidence and acceptance

Record source inspection, static checks, arithmetic checks, GPU or native
execution, the user's visual feedback and host installation as separate
statuses. A local Python portability test is not a test of a chat host's UI.
An example's capture or validation report says nothing about a new study.
State pending checks briefly after delivering the requested source and tutorial.

## TouchDesigner output

**With TDMCP connected.** Derivative publishes an MCP server that runs inside
TouchDesigner (https://github.com/TouchDesigner/TDMCP) and its own agent skills
(https://github.com/TouchDesigner/TDMCPSkills), among them `td-glsl-shaders`,
`td-mat-family`, `td-review-network` and `td-performance-check`. When the host
lists its tools:

- Read the user's network before changing it and build the study as one new
  component, as [native delivery](../../build/references/native-delivery.md)
  describes.
- Run the checks the dossier marks pending (compile reports, cook errors,
  captures, export and reopen) and record them as native evidence with build,
  OS and GPU.
- For API facts, prefer Derivative's skills when they are installed. They track
  the current build; [native API notes](native-api.md) is a dated summary.

This plugin is not that server and does not install it. Never claim control of
TouchDesigner because the plugin is installed.

**Without a native connection.** Deliver a source package: GLSL, `study.json`,
the complete `build.py` and `builder.py` plus any required helper, experiments,
controls, a network diagram and an implementation-linked tutorial. Describe the
native compile, capture and export checks as pending. TouchDesigner's Python
API does not exist in hosted Python: do not run `build.py`, `op`, `ui` or other
TouchDesigner code there.

Default to a portable GLSL TOP recipe when the brief does not need another
route, and state the target build as an assumption when the user's build is
unknown. Use the MAT or feedback route when the brief calls for it.

For a source ZIP, tell the user to extract it and run this in the TouchDesigner
Textport, with their own path:

```python
import runpy
component = runpy.run_path('/path/to/extracted-study/build.py')['build']()
```

On Windows, write the path as a raw string (`r'C:\studies\my-study\build.py'`)
or with forward slashes. This is a step for the user, not evidence that the
assistant ran anything. A
new `.tox` or `.toe` must be saved by a real TouchDesigner; never fabricate a
native binary. A bundled example's `.tox` may be offered unchanged as that
named example only. A web approximation is a separately labelled preview and
does not verify native behaviour.

`scaffold.py` leaves an example's `.tox`, captures and results behind and
resets its records, so a new study starts without borrowed evidence. If you
copy an example folder by hand instead, do the same before delivering.
