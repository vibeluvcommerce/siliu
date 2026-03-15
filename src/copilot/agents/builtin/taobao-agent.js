/**
 * TaobaoAgent - 淘宝/天猫专用 Agent
 * 
 * 适用场景：
 * - 商品搜索、比价
 * - 购物车管理
 * - 订单跟踪
 * - 店铺浏览
 */

const { BaseAgent } = require('../base-agent');

class TaobaoAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      id: 'taobao',
      name: '淘宝助手',
      icon: 'shopping-cart',            // Phosphor 图标
      color: '#FF6B00',                 // 淘宝橙色渐变
      colorEnd: '#FF8C42',
      description: '专为淘宝、天猫优化的购物助手',
      ...options
    });
  }

  /**
   * 淘宝特有领域知识
   */
  getDomainKnowledge() {
    return `【淘宝/天猫特有规则】

【搜索商品】
- 搜索框通常在页面顶部中央
- 搜索按钮是放大镜图标或"搜索"文字
- 搜索建议下拉框出现时，可以用 click 选择

【商品列表】
- 商品卡片包含：图片、标题、价格、销量、店铺名
- 点击商品图片或标题进入详情页
- 价格通常以 ¥ 符号开头

【商品详情页】
- 主图在左侧，可以左右切换
- 选择规格（颜色、尺码）通常在主图右侧
- "加入购物车" 和 "立即购买" 按钮在右侧明显位置
- 按钮颜色通常是橙色/红色

【购物车】
- 购物车图标通常在右上角
- 可以勾选/取消商品
- 支持批量操作（删除、移入收藏夹）

【订单相关】
- 提交订单前需要确认收货地址
- 有优惠券时，点击"使用优惠券"展开选择
- 运费信息通常在订单底部`;
  }
}

module.exports = { TaobaoAgent };
