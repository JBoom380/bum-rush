# BUM RUSH: a game by Jon Hill

A third-person cartoon shopping-cart chaos game. It is served at https://games.johnslagboom.com/bum-rush/ (GitHub Pages, repo JBoom380/bum-rush).

- Edit `src/*.js`, then run `python src/build.py`. It inlines everything into `index.html`, one offline file. Never edit `index.html` by hand.
- `src/SPEC.md` is the contract between the modules. `game.js` is the core.
- Test with `python src/tools/shot.py out.png --eval "BR.debug.play()"` (real GPU).
- The store brand is the made-up BULKZILLA WAREHOUSE. Never use real store names or logos.
