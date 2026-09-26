// Open a member in Hack Club's admin tools, from their profile menu.
//
// On desktop the renderer asks the main half for a tool by id, and the main
// half checks it against the allow-list, so a compromised page can't open
// arbitrary external links. In a browser the page could open any tab anyway, so
// it opens the tool itself, like a link.

import { SlickPlugin, type MenuTemplateItem } from '$slick';
import * as meta from './meta.ts';

type MenuFromTemplateProps = { template?: MenuTemplateItem[] };
type OverflowMenuProps = { memberId?: string };

const KEY_PREFIX = 'slick-admin-backend__';

export default class AdminBackend extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;

  /** The overflow menu knows whose profile it is; MenuFromTemplate does not. */
  private readonly MemberIdContext = React.createContext<string | null>(null);

  start() {
    this.api.patchComponent<OverflowMenuProps>('RimetoMemberProfileOverflowMenu', (Original) => (props) => (
      <this.MemberIdContext.Provider value={props.memberId ?? null}>
        <Original {...props} />
      </this.MemberIdContext.Provider>
    ));

    this.api.patchComponent<MenuFromTemplateProps>('MenuFromTemplate', (Original) => (props) => {
      const memberId = React.useContext(this.MemberIdContext);
      const template = props.template;
      if (!memberId || !Array.isArray(template)) return <Original {...props} />;
      if (template.some((item) => item?.key?.startsWith(KEY_PREFIX))) return <Original {...props} />;

      const tools = meta.TOOLS.filter((tool) => this.config[tool.id] !== false);
      if (!tools.length) return <Original {...props} />;

      const next: MenuTemplateItem[] = [
        ...template,
        { key: `${KEY_PREFIX}separator`, type: 'separator' },
        ...tools.map((tool) => ({
          key: `${KEY_PREFIX}${tool.id}`,
          label: tool.label,
          click: () => void this.open(tool.id, memberId),
        })),
      ];
      return <Original {...props} template={next} />;
    });
  }

  private async open(target: (typeof meta.TOOLS)[number]['id'], memberId: string) {
    if (this.api.loader !== 'electron') {
      const tool = meta.TOOLS.find((candidate) => candidate.id === target);
      // Called from the click itself, so the popup blocker lets it through.
      if (tool && meta.USER_ID.test(memberId)) window.open(tool.url(memberId), '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await this.api.main.call('open', target, memberId);
    } catch (error) {
      this.log(`could not open ${target}`, error);
    }
  }
}
