import { SlickPlugin } from '$slick';
import { componentName, preservesChildren, promotionKind } from './detect.ts';
import * as meta from './meta.ts';

export default class NoUpsell extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  static readonly requiredAPIs = [] as const;

  start() {
    const enabled = (name: string) => {
      const kind = promotionKind(name);
      return kind === 'ai' ? this.config.slackbotAI : kind === 'paid' && this.config.paidPlans;
    };
    this.api.patchComponent<{ children?: React.ReactNode }>(
      { filter: (component) => enabled(componentName(component)) },
      (Original) => {
        const keepChildren = preservesChildren(componentName(Original));
        return (props) => (keepChildren ? <>{props.children}</> : null);
      },
    );
    if (this.config.slackbotAI) {
      this.api.setStyle(`
        [data-qa="slackbot-ai-button"],
        [data-qa="canvas_ask_slackbot_button"],
        [data-qa="ask_slackbot_file_action"],
        [data-qa="ask_slackbot_file_summary"],
        [data-qa="search_answer_ask_slackbot_button"],
        [data-qa="channel-setup-foreword-slackbot-tile"],
        [data-qa="onboarding_tasks_get_started_with_slackbot_button"] {
          display: none !important;
        }
      `);
    }
  }
}
