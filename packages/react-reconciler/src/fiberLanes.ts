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
	// 此处需要注意：如果使用了 use Hook 然后没有使用 Suspense 来进行包裹，则页面是会被一直阻塞掉的
	// 因为期间就算进行 render 过程的话，只要到了 use Hook 对应的组件中就会被中断掉了
	root.pendingLanes &= ~lane;
	// 重置 suspendedLanes 和 pingLanes
	root.suspendedLanes = NoLanes;
	root.pingLanes = NoLanes;
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

/**
 * 标记某个 Lane 的某个更新被挂起了
 *
 * @param {FiberRootNode} root - wip 树上对应的 FiberRootNode
 * @param {Lane} suspendedLane - 被挂起的 Lane
 */
export function markRootSuspend(root: FiberRootNode, suspendedLane: Lane) {
	// 标记挂起的 suspendLane
	root.suspendedLanes |= suspendedLane;
	// 从 pendingLanes 中移除 suspendLane
	root.pendingLanes &= ~suspendedLane;
}

/**
 * 标记某个 Lane 被重新激活了
 *
 * @param {FiberRootNode} root - wip 树上对应的 FiberRootNode
 * @param {Lane} pingLane - 被激活的 Lane
 */
export function markRootPinged(root: FiberRootNode, pingLane: Lane) {
	root.pingLanes |= root.suspendedLanes & pingLane;
}

/**
 * 排除了 suspendedLanes 之后获取优先级最高的 Lane
 *
 * @param {FiberRootNode} root - FiberRootNode 实例对象
 * @returns {Lane} 当前最高优先级的 Lane
 */
export function getNextLane(root: FiberRootNode): Lane {
	const pendingLanes = root.pendingLanes;

	if (pendingLanes === NoLanes) {
		return NoLanes;
	}

	let nextLane = NoLanes;

	// 获取 pendingLanes 中没有被挂起的 Lanes
	// 这里存在两种情况：
	// 1. root.suspendedLanes 不为 NoLanes。则 suspendedLanes 为 pendingLanes 的子集
	// 2. root.suspendedLanes 为 NoLanes。则 suspendedLanes 为 pendingLanes，是等于关系
	const suspendedLanes = pendingLanes & ~root.suspendedLanes;

	if (suspendedLanes !== NoLanes) {
		nextLane = getHighestPriorityLane(suspendedLanes);
	} else {
		// 所有的 lane 都被挂起了，但是有的 lane 可能已经被 ping 了
		const pingedLanes = pendingLanes & root.pingLanes;
		if (pingedLanes !== NoLanes) {
			nextLane = getHighestPriorityLane(pingedLanes);
		}
	}

	return nextLane;
}

/**
 * 判断 set 里边的 Lanes 是否存在 subset 中的一个子集
 *
 * @param {Lanes} set - 目标 Lanes 集合
 * @param {Lane | Lanes} subset - 子集 Lane 或 Lanes 集合
 * @returns {boolean} 返回 boolean 值，为 true 表示有交集，为 false 表示没有交集
 */
export function includeSomeLanes(set: Lanes, subset: Lane | Lanes): boolean {
	return (set & subset) !== NoLanes;
}

/**
 * 在一个 lanes 的集合中移除对应的 renderLane
 *
 * @param {Lanes} set - lanes 集合
 * @param {Lanes | Lane} subset - 需要被移除的 lanes 子集
 */
export function removeLanes(set: Lanes, subset: Lanes | Lane) {
	return set & ~subset;
}
