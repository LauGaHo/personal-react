export type Flags = number;

export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;
// 代表该 fiberNode 本次更新需要触发 useEffect 操作
export const PassiveEffect = 0b0001000;

export const MutationMask = Placement | Update | ChildDeletion;

// 需要触发 useEffect 的情况，拥有 PassiveEffect 和 ChildDeletion
export const PassiveMask = PassiveEffect | ChildDeletion;
