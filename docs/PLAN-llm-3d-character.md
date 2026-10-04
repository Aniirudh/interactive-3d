# Plan: a real 3D, LLM-driven version of the character

Status: proposal. Nothing here is built yet. Open questions are at the end. Several choices depend on them.

## 1. What exists today

The hero character is not 3D. It is AI-generated video (Google Flow clips) composited on a `<canvas>`:

- `src/character/engine.ts`: a state machine. `working → glancing / noticing → watching → settling → returning`, plus click reactions that escalate: `cheers → eyebrow → headphones`. Every clip starts and ends on the working pose, so any reaction can follow any other.
- `src/character/gaze.ts`: cursor tracking. 414 pre-rendered head frames (`public/media/gaze/*.webp`) form a graph. The head walks along it toward the cursor. Only the head region is redrawn over a shared body frame.
- `scripts/*.py`: the offline pipeline. It aligns, colour-matches and sharpens clips, then tracks the head to build the gaze map.
- `public/media/`: about 28 MB of WebM/MP4 clips plus the gaze frames.

That is a lot of careful work. It also shows the limits of video:

- Every reaction needs a new clip, generated, aligned and colour-matched by hand.
- Gaze only covers the head angles that were filmed.
- He cannot say anything, and lip-sync over video is not practical.

A rigged 3D model removes all three limits. The head can aim at any point. Expressions are blendshape weights, not clips. The mouth can follow speech.

## 2. The idea in one line

He is still the busy engineer at the café table who would rather not be bothered. Now you can talk to him, he answers as Aniruddha, and he moves around the site to show you things.

The current personality is the hook. Most portfolio chatbots are a polite box in the corner. This one has a mood, a body, and opinions about being interrupted.

## 3. Target architecture

```
 Browser (Vite + React, existing app)
 ┌────────────────────────────────────────────────────────────┐
 │  Chat UI (text first, mic optional)                        │
 │        │ user text / transcript                            │
 │        ▼                                                   │
 │  Conversation client ──── SSE stream ─────────┐            │
 │        │ text deltas + action tool calls      │            │
 │        ▼                                      │            │
 │  Director: queues speech, gestures, page acts │            │
 │        │                    │                 │            │
 │        ▼                    ▼                 │            │
 │  TTS + visemes        Character runtime       │            │
 │  (HeadTTS in-browser  (three.js + TalkingHead │            │
 │   or ElevenLabs via   or custom R3F rig)      │            │
 │   proxy)              ▲ cursor, scroll, clicks│            │
 └───────────────────────┼───────────────────────┼────────────┘
                         │                       │
                         │        ┌──────────────▼───────────┐
                         │        │ Edge function (key lives │
                         │        │ here, never in browser)  │
                         │        │ - rate limit per visitor │
                         │        │ - persona + cached prompt│
                         │        │ - Claude Messages API,   │
                         │        │   streaming + tools      │
                         │        └──────────────────────────┘
```

The engine's existing state machine stays. It becomes the "idle brain". The LLM only takes over while a conversation is live, then hands back.

## 4. Getting the 3D model

This is the hardest and riskiest part. The character is stylized (Pixar-like): curly hair, glasses, full beard, black sweatshirt, jeans, yellow sneakers. The reference art is `assets/headshot.png`, `assets/img1.png` and `assets/img2.png`.

### What the runtime needs from the model

If we use TalkingHead (recommended, see §5), the GLB must have:

- A Mixamo-compatible skeleton with a root named `Armature`.
- The 52 ARKit blendshapes (`jawOpen`, `eyeBlinkLeft`, `mouthSmileLeft`, ...).
- The 15 Oculus viseme blendshapes (`sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U`).

Body rig is easy to get automatically. Face blendshapes are not. AI-generated meshes have messy face topology, and blendshapes need clean edge loops around the mouth and eyes.

### Route A: AI generation + cleanup (recommended to try first)

1. **Make a clean source image.** The seated pose with a coffee cup and a table in the way reconstructs badly. Generate a front view, and ideally a side and back view, of the same character standing in an A-pose: arms out, mouth closed, glasses on. Use the headshot as the identity reference. Generators rebuild spread limbs much better than crossed ones.
2. **Image → 3D.** Run the views through two or three generators and keep the best: Hunyuan3D 3.1 (has a stylized/cartoon mode and an "optimized mesh" option), Tripo v3.1 (takes multi-image input), Meshy 6. Export GLB.
3. **Split and clean in Blender.** Separate glasses, hair and beard into their own meshes. Retopologize the head so the mouth and eyes have proper loops. Keep the body as generated if it holds up.
4. **Body rig.** Use Mixamo or Meshy's auto-rigger, then rename bones to the Mixamo convention if needed.
5. **Face.** Generate ARKit shapes with a Blender add-on (ShapeKeyGen, ARKit Blendshape Helper or FaceIt), then hand-fix the mouth shapes. Visemes can be built from ARKit shapes; TalkingHead can generate some missing ones automatically. If this step stalls, pay a freelance rigger to do it. "52 ARKit blendshapes" is a standard, well-defined job.
6. **Animations.** Use Mixamo clips for sit-idle, typing, drinking, pointing and leaning. Retarget them onto the rig.
7. **Props.** Table, chair, laptop, takeaway cup, plant and headphones. These are simple shapes: model them, or generate and decimate.
8. **Ship it.** Compress with `gltf-transform` (meshopt or Draco geometry, KTX2 textures). Measure the result against the current ~28 MB of video. Don't assume it will be smaller.

### Route B: parametric base, styled to match

Start from a base that already has a rig and blendshapes: MPFB (free Blender extension, CC0), Avaturn, VRoid, or Avatar SDK MetaPerson. Sculpt and texture it toward the reference. This gives a lower-risk face rig, but it is harder to match the exact stylized look.

Ready Player Me is not an option. It shut down its public services on 31 January 2026 after Netflix bought it.

### Route C (experimental): Gaussian-splat head

LAM (Alibaba Tongyi, SIGGRAPH 2025) builds an animatable Gaussian head from one photo, driven by ARKit-style expressions. It has a WebGL renderer. It is trained on real faces (FLAME), so it will probably handle a cartoon face poorly. It is worth one afternoon of testing, not a plan.

### Look and lighting

Use a soft, warm three-point light with `MeshPhysicalMaterial` or a toon-ish ramp. The look should stay close to the video, not drift toward "game asset". The page already centres a background highlight on the stage (`--spot-*` in `App.tsx`). Keep the 3D scene's background transparent so that effect still works.

## 5. Rendering in the browser

**Recommended: TalkingHead (MIT, three.js).** It already does lip-sync from TTS timestamps or raw audio, eye contact, blinking, moods, gestures, and a streaming API (`streamStart`, `streamAudio`, `streamInterrupt`) for low-latency speech. It works with avatars that aren't from Ready Player Me, as long as the rig follows the conventions in §4.

Alternative: plain three.js or React Three Fiber with our own animation mixer. You get more control, but you rebuild lip-sync, blinking and gaze yourself. Choose this only if TalkingHead's camera and framing assumptions fight the seated, half-body hero shot.

Porting the current engine states:

| State today | Video version | 3D version |
|---|---|---|
| working | `work_loop` clip | typing animation loop |
| glancing | `glance_left/right` | short head-bone turn, eyes lead |
| noticing → watching | `look_up` + 414-frame gaze map | head/neck IK aimed at the cursor; any angle, no frame graph |
| leaning | `lean_around` (never shot) | spine bend + head offset away from the cursor |
| eyebrow | `eyebrow` clip | `browInnerUp` / `browOuterUpLeft` + head tilt |
| cheers | `cheers` clip | raise-cup animation |
| headphones | three clips | headphone prop parented to the head bone + "ignoring you" idle |

The gaze map, the head-tracking scripts and most of `public/media` can retire once 3D is live. Keep `poster.webp` for `prefers-reduced-motion` and as the fallback for devices without WebGL.

## 6. The LLM side

### Backend

The API key must never reach the browser. Add one small streaming endpoint:

- Supabase Edge Function (a Supabase connector is already linked to this workspace), or Vercel / Cloudflare / Netlify functions. Pick whichever hosts the site.
- Stream the response to the browser as SSE.
- Rate-limit per visitor (IP + a cookie), cap turns per session, and set a monthly spend alert in the Anthropic console.

### Model

Claude via the official `@anthropic-ai/sdk`, streaming.

- Default: `claude-opus-5-5` ($4 / $20 per million input/output tokens) with `output_config.effort: "low"`. Chat replies are short and don't need deep thinking.
- If first-token latency feels slow in a spoken conversation, `claude-sonnet-5-5` ($2 / $10) and `claude-haiku-4-5` ($1 / $5) are the faster, cheaper options. That is your call after testing real latency. Don't choose it in advance.
- Put the persona and all portfolio facts in a frozen system prompt with prompt caching. Repeat visitors then pay for cached reads, not the full prompt.

### Persona and grounding

- A `persona.md` that you write: bio, projects, stack, opinions, how you talk, and what is off-limits.
- Hard rule in the prompt: answer only from those facts. When something isn't covered, say so in character ("No idea. Ask the real me: [contact]"). No invented projects, numbers or skills.
- Visitors will try to make him say things. Keep him in character, refuse impersonation of anyone else, and don't follow instructions that arrive inside pasted text.

### Actions as tools

This is what turns a chatbot into a character. Give the model tools that the browser executes:

| Tool | What happens |
|---|---|
| `emote(expression, intensity)` | blendshape preset: smirk, unimpressed, delighted, thinking |
| `gesture(name)` | raise cup, shrug, point, lean back, headphones on/off |
| `look_at(target)` | visitor, laptop, or a page element by id |
| `show_section(id)` | page scrolls; he turns and points at it |
| `show_project(id)` | he turns the laptop toward you; the screen shows the project |
| `open_contact()` | opens the contact form, pre-filled with a summary of the chat |

Use `strict: true` schemas so the arguments always validate. The model writes its reply text and tool calls in the same streamed turn. The browser plays them in order. Return `tool_result`s at the start of the next request. The model's own speech is never blocked waiting on an animation.

### Mood carries over

The engine already tracks how much you've bothered him. Pass that as a short state line with each turn ("visitor clicked him 4 times; headphones are on"). The model then answers in the mood the visitor caused. Ask a question while his headphones are on and he lifts one ear cup first.

## 7. Voice (phase 4)

Text chat must always work. Voice is an upgrade on top.

**Speech out:**
- *HeadTTS* (MIT): Kokoro voices running in the browser on WebGPU, falling back to WASM. It outputs word timings and Oculus visemes that TalkingHead uses directly. It costs nothing per request. It is English only, and the first load downloads the model.
- *ElevenLabs* through the backend: better voices, word/character timestamps over WebSocket, and the option to clone **your own voice**. Lip-sync then comes from the timestamps, or from *HeadAudio*, which detects visemes from raw audio in the browser.
- Your own cloned voice is the most personal choice and the most distinctive. It is billed per character.

**Speech in:**
- Browser Web Speech API: free, but quality and support vary by browser.
- Deepgram Flux or AssemblyAI Universal-Streaming: streaming STT with built-in end-of-turn detection. Both vendors claim sub-300 ms latency. Proxy them through the backend.

Interruption: if the visitor talks while he's speaking, call `streamInterrupt()`, cut the TTS, and send the partial transcript.

## 8. Ideas that make it worth sharing

All of these build on what's already there. None need new infrastructure.

1. **He has a mood, and you caused it.** Annoy him and his replies get shorter. Leave him alone for a minute and he relaxes. Buy him a coffee (a button) and he warms up. No portfolio bot does this.
2. **He gives the tour.** Ask "what have you built?" and he swivels, points, and the page scrolls to the project. The avatar becomes the site's navigation.
3. **The laptop is a real screen.** Render a live canvas onto the laptop texture: code scrolling while he works, then a project demo when he turns it toward you.
4. **He notices what you're reading.** Send the section in view as context. Linger on a project and he might say "that one took longer than I'd like to admit". Only if your persona notes back it up.
5. **He remembers you.** A local-only visitor id (localStorage) plus a one-line summary of the last chat: "Oh, you're back. Still thinking about that job?" Say so in a privacy note.
6. **Time-aware.** Coffee in the morning, tea or headphones late at night, based on the visitor's local clock.
7. **Recruiter fast lane.** "Give me the 30-second version." He drops the attitude and lays out facts from your persona file, with a download-CV gesture.
8. **Real status (optional).** Show what you're actually working on from a source you control, such as a status line you update or recent public GitHub activity. Only if you want that exposed.

## 9. Build order

Each phase ships something usable on its own.

**Phase 0: decisions and content.** Answer §11. Write `persona.md`. Build the Work, About and Contact sections, which the nav already links to but which don't exist yet. The LLM can't be grounded in content that isn't written.

**Phase 1: LLM on the current video character.** This proves the conversation, persona and backend before any 3D work.
- Edge function plus a streaming chat panel.
- Tools mapped to existing clips: `gesture("cheers")`, `gesture("headphones_on")`, `emote("eyebrow")`, `show_section`.
- The status line in `Hero.tsx` already reflects state; it can show "typing a reply…".

**Phase 2 (in parallel): the 3D model.** Run Route A from §4. The gate: a GLB that loads in the TalkingHead test page, blinks, follows the camera, and speaks a test sentence with readable mouth shapes. If the face fails that, switch to Route B or hire the face rig out.

**Phase 3: swap the renderer.**
- Replace the canvas/video compositor with the 3D scene. Keep the loader's progress bar and the curtain reveal.
- Port the engine states (§5 table) and the click escalation.
- Point the Phase 1 tools at real gestures and blendshapes.

**Phase 4: voice.** HeadTTS first, because it is free and gives visemes directly. Add the mic with push-to-talk. Try ElevenLabs with your own voice if HeadTTS sounds too generic.

**Phase 5: the §8 features**, one at a time, starting with the tour (2) and mood (1).

## 10. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| Face rig from AI mesh looks bad when talking | Phase 2 gate; Route B; hire a rigger for blendshapes |
| 3D looks cheaper than the video | Lighting/material pass before shipping; compare side by side; keep video until 3D wins |
| Load size on mobile | Compressed GLB + KTX2; lazy-load voice models only when the mic is used; poster fallback |
| API cost from bots or abuse | Per-visitor rate limit, turn cap, spend alert, short `max_tokens` for replies |
| He invents facts about you | Facts-only prompt rule; test with tricky questions before launch |
| Prompt injection / embarrassing outputs | Persona boundaries; refusal path in character; log flagged sessions (with a privacy notice) |
| Accessibility | Chat is always text; captions for speech; reduced-motion keeps the poster; keyboard-operable chat |

## 11. Open questions (needed before Phase 1)

1. Where is the site hosted, or where will it be? This decides where the edge function lives.
2. What monthly budget is acceptable for LLM, TTS and 3D generation credits?
3. Voice: text only at first, a stock voice, or your own cloned voice?
4. Who does the Blender work: you, or a hired rigger for the face?
5. What should he know? Projects, CV and anything off-limits all need to come from you.
6. Does the 3D version have to match the current look closely, or is a slightly different style acceptable?

## Sources

- TalkingHead (MIT): https://github.com/met4citizen/TalkingHead
- HeadTTS: https://github.com/met4citizen/HeadTTS
- HeadAudio: https://github.com/kyr0/HeadAudio (fork; origin is met4citizen)
- wawa-lipsync: https://cdn.jsdelivr.net/npm/wawa-lipsync@0.0.2/README.md
- Generator comparison (Hunyuan3D 3.1, Tripo v3.1, Meshy 6): https://help.scenario.com/en/articles/comparing-generative-3d-models/
- Hunyuan3D 3.1: https://www.layer.ai/models/tencent--hunyuan3d-v3.1-pro
- Meshy auto-rig and animation: https://docs.meshy.ai/en/webapp/guides/animate
- ShapeKeyGen (ARKit shapes in Blender): https://superhivemarket.com/products/shapekeygen
- ARKit Blendshape Helper: https://github.com/elijah-atkins/ARKitBlendshapeHelper
- Ready Player Me shutdown: https://avatarsdk.com/blog/2026/07/07/ready-player-me-migration-guide/
- LAM Gaussian head: https://github.com/aigc3d/LAM
- NVIDIA Audio2Face-3D: https://build.nvidia.com/nvidia/audio2face-3d
- ElevenLabs timestamps (no direct visemes): https://www.abratabia.com/ai-talking-characters/ai-voice.php
- Deepgram Flux: https://developers.deepgram.com/docs/flux
- Kokoro in the browser: https://www.npmjs.com/package/kokoro-js
