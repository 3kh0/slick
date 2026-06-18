'use strict';
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, 'vendor');

module.exports = {
  meta: {
    name: 'oneko',
    description: 'cat follow mouse (real)',
  },

  main(ctx) {
    let script;
    let gifB64;
    try {
      script = fs.readFileSync(path.join(VENDOR, 'oneko.js'), 'utf8');
      gifB64 = fs.readFileSync(path.join(VENDOR, 'oneko.gif')).toString('base64');
    } catch (e) {
      ctx.log('failed vendor', e.message);
      return;
    }
    script = script
      .replace('if (isReducedMotion) return;', '')
      .replace('nekoEl.style.backgroundImage = `url(${nekoFile})`;', '');
    ctx.injectCSS(
      `#oneko{background-image:url("data:image/gif;base64,${gifB64}") !important;image-rendering:pixelated !important}`,
    );
    ctx.injectJS(`(function(){if(document.getElementById('oneko'))return;\n${script}\n})();`);
  },
};
