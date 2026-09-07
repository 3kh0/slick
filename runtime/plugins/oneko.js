'use strict';

const fs = require('fs');
const path = require('path');
const { embed } = require('../embed');

const vendor = path.join(__dirname, '../../plugins/oneko/vendor');
let script = fs.readFileSync(path.join(vendor, 'oneko.js'), 'utf8');
const gif = fs.readFileSync(path.join(vendor, 'oneko.gif')).toString('base64');
script = script
  .replace('if (isReducedMotion) return;', '')
  .replace('nekoEl.style.backgroundImage = `url(${nekoFile})`;', '');

module.exports = embed({
  id: 'oneko',
  description: require('../../plugins/oneko').meta.description,
  css: `#oneko{background-image:url("data:image/gif;base64,${gif}") !important;image-rendering:pixelated !important}`,
  renderer: `(function(){if(typeof document==='undefined'||document.getElementById('oneko'))return;\n${script}\n})();`,
});
