# AI log

## Tools and what they were used for

| Tool | Used for |
|---|---|
| Claude Code (Claude Opus 5.5) in VS Code | Reading the brief, proposing the stack, writing the code and tests, running tests, rendering the drawing to screenshots for visual checks, and drafting README.md |
| TODO(Ahsan): second tool used for the adversarial review, if any | Independent review of commit `c6e6da8` on a fresh clone |

DECISIONS.md was written without AI.

## Key prompts

TODO(Ahsan): pick 3 to 5 prompts you actually gave, and say in one line what each produced.

1.
2.
3.

## One time the AI was wrong, and how I caught it

TODO(Ahsan): write this in your own words. Facts to check against:

- What was wrong: the design name was only trimmed and length-checked. Control
  characters and broken Unicode got through.
- Effects, all reproduced: a name starting with NUL (`\u0000`) gave a 500 error,
  because SQLite's `length()` stops at NUL and the database CHECK failed after
  validation had passed. A NUL inside the name was saved, and the downloaded SVG
  became invalid XML. A lone surrogate (`\uD800`) was silently stored as `�`.
- How it was caught: an adversarial review of commit `c6e6da8` on a fresh clone,
  sending hostile requests to the running API. The 35 tests the AI wrote were
  all green, because none of them tried these inputs.
- Fix: commit `6a953f6`. Names must be well-formed Unicode without control
  characters (400 otherwise), the SVG escaper drops XML-illegal characters, and
  each case has a test that failed before the fix.

Other AI mistakes during the build, caught in the same session:

- Lifting height was first modelled as the hook height above the floor. A
  screenshot of a short-lift case drew a huge hoist, which showed the mistake;
  it is now the vertical hook travel below the highest hook position (commit `cb37996`).
- The default API port collided with another program on the development
  machine (seen as `EADDRINUSE` in the log); it moved to 8787.
