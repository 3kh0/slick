import { plugins, themes, version } from 'slick:options-data';
import { mount, optionsBrowser } from './options.ts';

mount(optionsBrowser(), { plugins, themes, version });
