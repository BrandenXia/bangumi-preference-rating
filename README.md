# Bangumi 偏好评分

通过几次动画比较，得到保存在本地的两位小数偏好评分。需要至少 50 部有 1–10 分评分的动画；只读取公开收藏，不修改 Bangumi 评分。

```sh
npm ci
npm run build
```

将 `dist/bangumi-preference-rating.js` 的内容放入 Bangumi 开发者平台的超合金组件脚本编辑器，保存并启用。动画详情页有「偏好评分」入口；「个性化」面板可选择算法。组件尚未经过登录状态下的原生安装验证。

支持继续比较、撤销、跳过、模型切换和 JSON 备份。数据按用户保存在当前浏览器、当前域名下；换域名或设备请导出 / 导入。分数是近似建议，区间不是校准后的置信区间。

开发检查：`npm run check && npm test && npm run build`（Node 24+）。实现取舍和兼容性见 [开发说明](docs/implementation.md)。
