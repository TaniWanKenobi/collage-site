# Features to build eventually

Ideas for later. Not started unless marked. Add new ones at the bottom of the right section.

## Home collage

- [x] **Shuffling tagline.** *(Done: makes → ships → prints → solders → automates; `src/components/collage/Tagline.astro`, words in `src/data/kinds.json`.)* Replace the fixed outlined "makes things." with a word that shuffles through what I do (e.g. "makes things." → "prints things." → "ships things." → "breaks things."). Respect `prefers-reduced-motion` (show one word, no animation).
- [x] **Click the word to see the work.** *(Done: projects list `kinds` in frontmatter / models.json; Projects has matching filter chips and opens filtered from `?kind=`.)* Each shuffled word links to the matching work: clicking "prints" zooms to the 3D-printing projects, "ships" to the apps, and so on. Needs a tag per project so each word can filter or fly to its set.
- [x] **Fix the "e" overlap in "makes things."** *(Done: letter-spacing -0.04em → -0.012em.)* The outlined letters overlap (tight `letter-spacing: -0.04em` makes the strokes of "k/e/s" cross), so the letters need fixing: loosen the spacing or adjust the overlapping letters so each outline reads cleanly.

## Tamagotchi (3D model on the home collage)

- [x] **Face the user.** *(Done: stood upright, sways instead of spinning; front poster `public/models/tamagotchi-front.webp`.)* Turn the Tamagotchi model so its screen faces the viewer by default (it currently sits at an angle, showing the top/side).
- [x] **Basic interactive interface.** *(Done: `src/scripts/tama-toy.ts`. A = menu/next, B = select, C = back; FEED / PLAY / WORK / HI; buzzer beep; keys 1/2/3 when focused.)* Make the buttons clickable and the screen live: test a simple UI where pressing the buttons changes what the screen shows.
- [ ] *(Long term, maybe)* **Tamagotchi as a browser for the home page.** Scroll through things on the home page using its buttons and screen.
- [ ] *(Long term, maybe)* **Zoom into the Tamagotchi** so its screen shows accomplishments, especially the ones about teaching people things.

## A/B tests to run

- [ ] Whimsy level (current full whimsy vs. a calmer variant), once everything else is done.

## Launch checklist

- [ ] **Reminder: get photos from tobycm's shared Google Photos album** for the Photo album (to replace the sample photos). Album is linked in this Slack message: https://hackclub.slack.com/archives/C0BR742DQ0K/p1793944531504259?thread_ts=1793933442.290149&cid=C0BR742DQ0K (the album link itself is kept out of this public repo). Run `npm run photos` after adding them to `src/assets/photos/`.
- [ ] Replace every placeholder. `npm run check:placeholders` lists them. Then set `"launch": true` in `src/data/site.json`; from then on the build fails if any placeholder is left.
- [ ] Deploy the guestbook Worker (`guestbook-worker/README.md`) and set `PUBLIC_GUESTBOOK_URL`.
- [ ] Pick the A/B winners and delete the losing variants.
