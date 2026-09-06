/**
 * 功能模块装配点：import 即完成注册表登记。
 * 后续票据的接入方式：新建 features/<域>/<模块>.ts(x)，在其中 register(...)，
 * 然后在下面加一行 import。核心 App/Shell 组件永远不需要修改。
 *
 * 侧栏页面树 / 反向链接 / 标签面板由 master 上 DEV-003 真实实现负责注册，
 * 本分支（DEV-005）只新增 frontmatter registry，避免重复注册。
 */
import './dock';
import './statusbar';
import './commands/builtin';
import './settings';
import './frontmatter/registry';
