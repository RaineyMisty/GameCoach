'use strict';

// Seed memories are copied into each local user once, then remain editable/deletable.
window.GAMECOACH_MEMORY_DEFAULTS = Object.freeze([
  { id: 'analysis-support', title: '辅助选人', topics: ['support'], text: '可以主动探索大胆、非常规的辅助选择，分析它能创造的机会、成立条件和代价。创意服务于当前阵容，不必每次推荐冷门英雄。' },
  { id: 'analysis-jungle', title: '打野决策', topics: ['jungle'], text: '可以考虑上半区或下半区投入、线路配合、资源交换，以及放弃另一侧会带来的影响。' },
  { id: 'analysis-carries', title: '中下双 C', topics: ['carries', 'draft'], text: '可以比较中下双 C 各自的强势期，判断谁先带节奏、谁需要发育，以及双方的窗口能否衔接。' },
  { id: 'analysis-development', title: '阵容发展', topics: ['development', 'draft'], text: '可以推演阵容前中后期的变化，分析团战、单带、抓人和资源争夺分别如何形成赢法。' },
  { id: 'analysis-opponent', title: '对手应对', topics: ['opponent', 'draft'], text: '可以考虑对方会怎样破解当前打法，以及原计划失败后还能如何调整；不把一种赢法说成唯一解。' },
  { id: 'analysis-roles', title: '本局分工与摇摆', topics: ['draft'], text: '选人时可以先结合已选阵容判断待补位置和可能的摇摆，简短说明关键假设。常用位置不等于本局位置，熟悉的英雄也不是候选范围。' },
  { id: 'analysis-evidence', title: '经验与判断', topics: ['review'], text: '讨论战报时可以区分用户描述、已知机制与推测，分别评价选人思路、实际执行和对手失误；认可有具体依据，单局获胜不直接证明策略能稳定复用。' },
]);
