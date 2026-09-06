/**
 * 功能模块装配点：import 即完成注册表登记。
 * 后续票据的接入方式：新建 features/<域>/<模块>.ts(x)，在其中 register(...)，
 * 然后在下面加一行 import。核心 App/Shell 组件永远不需要修改。
 */
import './sidebar';
import './dock';
import './statusbar';
import './git';
import './statusbar/index-status';
import './commands/builtin';
import './settings';
import './frontmatter/registry';
import './search';
import './search/commands';
