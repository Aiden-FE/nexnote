/** DEV-099：simple-mind-map 插件子路径导入（包无 exports 映射、插件源码无类型）。 */
declare module 'simple-mind-map/src/plugins/Drag.js' {
  const DragPlugin: Record<string, unknown>;
  export default DragPlugin;
}
