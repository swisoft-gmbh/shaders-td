# Shaders for TouchDesigner

Four agent skills that help you make an original TouchDesigner shader and a
tutorial that explains it. They come with a reference library of Maxime
Heckel's published shader articles and code, thirteen example studies, and
scripts that build and check a study.

The articles teach shaders for the web (WebGL, WebGPU, React Three Fiber).
The TouchDesigner side is new work by this toolkit. It is not a fine-tuned
model and not an endorsed product.

## Credits

Knowledge base: Maxime Heckel's published shader articles and open-source code
(blog.maximeheckel.com). This toolkit is built on his work and credits it
throughout. It is independent: not affiliated with, sponsored or endorsed by
Maxime Heckel.

- Blog: [blog.maximeheckel.com](https://blog.maximeheckel.com/)
- Blog source: [github.com/MaximeHeckel/blog.maximeheckel.com](https://github.com/MaximeHeckel/blog.maximeheckel.com)
- Licences and per-file credits: [NOTICE.md](NOTICE.md),
  [ATTRIBUTION.md](ATTRIBUTION.md) and [THIRD-PARTY.md](THIRD-PARTY.md)

TouchDesigner is a registered trademark of Derivative Inc. This plugin is not
affiliated with or endorsed by Derivative.

## Licence in plain words

The plugin is free and for non-commercial use (CC BY-NC 4.0). A study you
start from one of its seeds stays under that licence: use it and share it
non-commercially, with credit to Swisoft GmbH and to Maxime Heckel. Paid shows,
commissions and client work are not covered. His blog code is MIT. Read
[NOTICE.md](NOTICE.md) before reusing anything outside the plugin.

## Install

**Claude Code** (inside a session):

```text
/plugin marketplace add swisoft-gmbh/shaders-td
/plugin install shaders-td@shaders-td
```

Or from a shell:

```sh
claude plugin marketplace add swisoft-gmbh/shaders-td
claude plugin install shaders-td@shaders-td
```

The skills then appear as `/shaders-td:research`, `/shaders-td:build`,
`/shaders-td:explain` and `/shaders-td:review`. Update later with
`claude plugin update shaders-td@shaders-td`.

**Codex:**

```sh
codex plugin marketplace add swisoft-gmbh/shaders-td
codex plugin add shaders-td@shaders-td
```

**Without a marketplace:** download the plugin ZIP from the
[latest release](https://github.com/swisoft-gmbh/shaders-td/releases/latest),
unzip it and load the folder with `claude --plugin-dir <folder>`. Keep the
folder whole: the skills read each other's references, the examples and the
licence files.

## Use the plugin

Ask for what you want to see, for example:

> Help me create an audio-reactive topographic material in TouchDesigner.
> Ask about the visual direction, build it, then write a detailed tutorial
> with diagrams, the actual code, intermediate views and experiments I can
> repeat.

### The four skills

| Command | What it does | You get |
|---|---|---|
| [`/shaders-td:research`](skills/research/SKILL.md) | Finds the technique in the articles and their code, and compares ways to do it in TouchDesigner. | Options with sources and limits. |
| [`/shaders-td:build`](skills/build/SKILL.md) | Settles the open design choices, then writes the shader and its network. | GLSL, a network builder, presets and debug views. |
| [`/shaders-td:explain`](skills/explain/SKILL.md) | Teaches the finished network with experiments and exact code excerpts. | A tutorial tied to the real source. |
| [`/shaders-td:review`](skills/review/SKILL.md) | Checks the shader, the tutorial, the credits and the delivery. | Findings ordered by impact, fixes, and what is still untested. |

In Codex, call them as `$research`, `$build`, `$explain` and `$review`. Both
hosts also pick the right skill on their own when you ask for shader work.

## What installs with it

- A reference library of 381 files: 17 graphics articles and 10 supporting
  articles by Maxime Heckel, the code and widgets they use, and their notices.
  Every file is hash-verified against its source commit.
- Indexes of 141 web scenes and 342 source files inside them, for looking up
  how an effect was built. They are web code, not TouchDesigner projects.
- Guides for TouchDesigner: the GLSL contract, feedback loops, materials,
  refraction glass, builders, and how to gather evidence without TouchDesigner.
- Eight [native studies](examples/README.md) with source, real `.tox` exports,
  captures and tutorials, and the [five mechanism tests](examples/FIVE-MECHANISMS.md)
  among them.
- Five [liquid-glass studies](examples/LIQUID-GLASS.md). These never ran in
  TouchDesigner: they were checked with glslang compiles, WebGL2 previews and
  unit tests, and have no `.tox`.
- Scripts that start a study from a seed, build it inside TouchDesigner,
  render its tutorial from the real code and check its structure. They need
  only Python 3.10 or later, no packages.

About 70 MB. The liquid-glass studies are also attached to each release as
ZIPs.

## TouchDesigner

The native examples were built and tested on **TouchDesigner 2025.33230, macOS
15.8.1, Apple Silicon**, with GLSL 4.60. Other builds and platforms need their
own checks.

The plugin is skills and files. It does not control TouchDesigner. Two ways to
run what it writes:

- **With Derivative's MCP server.** If you use
  [TDMCP](https://github.com/TouchDesigner/TDMCP), the agent can build and
  check the study inside your TouchDesigner. Derivative's own skills
  ([TDMCPSkills](https://github.com/TouchDesigner/TDMCPSkills)) cover the
  TouchDesigner API in general; this plugin adds the shader techniques, the
  sources and the tutorial.
- **By hand.** Run the study's builder in the Textport:

  ```python
  import runpy
  component = runpy.run_path('/path/to/contour-loom/build.py')['build']()
  ```

To open an example, drag its `native/study.tox` into a network, open `out`'s
viewer and use the component's Study page. See
[native delivery](skills/build/references/native-delivery.md).

To start your own study from a seed:

```sh
python3 skills/build/scripts/scaffold.py /new/study --example phosphor-memory
```

The seed is a working example to rebuild for your brief, with the example's
results left behind. A copied example with a new title is not an original
shader.

## Chat hosts

The skills also work in a chat host without a shell, such as ChatGPT or
claude.ai. The assistant reads the bundled references through the host. With
file tools it returns real downloads; without them it returns complete named
source files and the tutorial in the chat. Rendering and saving a `.tox` need
TouchDesigner, so those checks stay pending until you run them. See
[hosts](skills/research/references/chat-web.md).

## Evidence

[validation/](validation/README.md) holds what was tested and how: native
compile and render, feedback behaviour, export and reopen for the eight native
studies. That is separate from whether a shader looks right to you, how fast
it runs, and whether it works on your build. No GPU compatibility or benchmark
claim is made.

Run the script tests with `python3 -m unittest discover -s tests`.

[maintainer/](maintainer/README.md) records how the library was assembled and
re-checked against the live sources, last on 14 November 2026.

## Support, privacy, terms

https://marcoleder.ch/shaders-td/
