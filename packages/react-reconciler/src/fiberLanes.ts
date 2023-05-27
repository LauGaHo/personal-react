import ReactCurrentBatchConfig from 'react/src/currentBatchConfig';
import {
	unstable_getCurrentPriorityLevel,
	unstable_IdlePriority,
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority
} from 'scheduler';
import { FiberRootNode } from './fiber';

export type Lane = number;
export type Lanes = number;

export const SyncLane = 0b00001;
export const NoLane = 0b00000;
export const NoLanes = 0b00000;
// 指代连续输入事件，如：拖拽操作
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

/**
 * 给定两个优先级 Lane，将这两个 Lane 合并成一个 Lanes
 * @param laneA {Lane} 优先级 Lane
 * @param laneB {Lane} 优先级 Lane
 */
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

/**
 * 根据任务类型，请求返回一个优先级
 */
export function requestUpdateLane() {
	// 判断是否处于 Transition 状态中
	const isTransition = ReactCurrentBatchConfig.transition !== null;
	// 处于 Transition 状态直接返回 TransitionLane
	if (isTransition) {
		return TransitionLane;
	}

	// 从当前上下文获取当前调度器正在执行任务的优先级
	const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
	const lane = schedulerPriorityToLane(currentSchedulerPriority);
	return lane;
}

/**
 * 根据给定的 lanes 获取当前优先级最高的 lane
 * @param lanes {Lanes} 优先级集合
 */
export function getHighestPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes;
}

/**
 * 判断某个优先级是否是另一个优先级集合的子集
 * @param set {Lanes} 优先级集合
 * @param subset {Lane} 给定优先级
 */
export function isSubsetOfLanes(set: Lanes, subset: Lane) {
	return (set & subset) === subset;
}

/**
 * 从 FiberRootNode.pendingLanes 中移除给定的 lane
 * @param root {FiberRootNode} fiber 的根节点
 * @param lane {Lane} 需要被移除的优先级
 */
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}

/**
 * 将给定的 lanes 提取最高优先级的 lane，并且将其转换成 schedulerPriority
 * @param lanes {Lanes} 优先级集合
 */
export function lanesToSchedulerPriority(lanes: Lanes) {
	// 获取最高优先级的 lane
	const lane = getHighestPriorityLane(lanes);

	if (lane === SyncLane) {
		return unstable_ImmediatePriority;
	}

	if (lane === InputContinuousLane) {
		return unstable_UserBlockingPriority;
	}

	if (lane === DefaultLane) {
		return unstable_NormalPriority;
	}

	return unstable_IdlePriority;
}

/**
 * 将 schedulerPriority 转换成 lane
 * @param schedulerPriority {number} schedulerPriority 调度器的优先级类型
 */
export function schedulerPriorityToLane(schedulerPriority: number): Lane {
	if (schedulerPriority === unstable_ImmediatePriority) {
		return SyncLane;
	}

	if (schedulerPriority === unstable_UserBlockingPriority) {
		return InputContinuousLane;
	}

	if (schedulerPriority === unstable_NormalPriority) {
		return DefaultLane;
	}

	return NoLane;
}
