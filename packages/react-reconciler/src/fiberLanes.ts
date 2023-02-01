import { FiberRootNode } from './fiber';

export type Lane = number;
export type Lanes = number;

export const SyncLane = 0b0001;
export const NoLane = 0b0000;

export const NoLanes = 0b0000;

// 给定两个优先级 Lane，将这两个 Lane 合并成一个 Lanes
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

// 根据任务类型，请求返回一个优先级
export function requestUpdateLane() {
	return SyncLane;
}

// 根据给定的 lanes 获取当前优先级最高的 lane
export function getHighestPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes;
}

// 从 FiberRootNode.pendingLanes 中移除给定的 lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}
