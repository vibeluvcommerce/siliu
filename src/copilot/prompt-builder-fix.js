// 添加视觉分析指南
    const visualGuide = `

【截图信息】
- 尺寸: ${observation.screenshot.width}x${observation.screenshot.height} 像素
- 文件大小: ${Math.round(observation.screenshot.size / 1024)}KB
- 格式: ${observation.screenshot.mimeType}

【视觉分析指南 - 关键】
你现在已经收到了当前页面的截图，请结合 DOM 信息和截图进行双驱动分析：

1. 页面状态判断：
   - 从截图观察页面是否还在加载（loading 动画、骨架屏）
   - 是否有弹窗、遮罩层、广告遮挡
   - 页面布局是否正常渲染

2. 元素定位（结合 DOM + 视觉）：
   - 先查看 DOM 元素列表中的候选元素
   - 在截图中确认该元素是否可见
   - 如果可见，估计其在截图中的百分比位置 (x: 0-1, y: 0-1)
   - 如果不可见，判断是否需要滚动

3. 坐标系统说明：
   - 截图左上角为 (0, 0)，右下角为 (1, 1)
   - 返回坐标格式: {"x": 0.5, "y": 0.3}
   - 例如：截图中心点为 {"x": 0.5, "y": 0.5}

4. 决策优先级：
   - 如果截图显示页面还在 loading → 使用 wait 操作
   - 如果目标元素在截图中可见 → 可以使用 coordinate 点击
   - 如果目标元素在 DOM 中但截图中不可见 → 使用 scroll 操作
   - 如果不确定 → 优先使用 selector 或 xpath

【坐标点击格式】
{
  "action": "click",
  "target": {
    "type": "coordinate",
    "x": 0.234,
    "y": 0.567
  },
  "reason": "从截图看到登录按钮在左上角约 1/4 处"
}

【等待操作】
{
  "action": "wait",
  "duration": 2000,
  "reason": "截图显示页面还在 loading 动画中"
}

【执行确认机制说明】
你的每一步操作都会经过执行确认：
- 系统会自动对比执行前后的截图
- 如果页面没有变化，会标记为"不确定"
- 如果检测到异常，会提示调整策略
- 你可以通过截图验证自己的操作是否达到预期

请基于以上信息，分析当前状态并给出下一步操作。`;

    return {
      text: domPrompt + confirmationGuide + visualGuide,
      hasVisual: true
    };
  }
}

module.exports = { PromptBuilder, ACTION_SCHEMA };