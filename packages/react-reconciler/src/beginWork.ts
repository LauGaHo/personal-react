// 递归中的递阶段

import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { FiberNode } from './fiber';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import { HostComponent, HostRoot, HostText } from './workTags';

export const beginWork = (wip: FiberNode) => {
	// 比较，并返回子 fiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip);

		case HostComponent:
			return updateHostComponent(wip);

		case HostText:
			return null;

		default:
			if (__DEV__) {
				console.warn('beginWork为实现的类型');
			}
			break;
	}
};

// 针对 HostRootFiber 的 mount 逻辑
function updateHostRoot(wip: FiberNode) {
	// 获取 wip 原本的 state
	const baseState = wip.memoizedState;
	// 获取 wip 当前的 updateQueue (里边装着最新的 Update 实例对象)
	const updateQueue = wip.updateQueue as UpdateQueue<Element>;
	// 获取 updateQueue 中最新的 Update 实例对象
	const pending = updateQueue.shared.pending;
	// 获取最新的 Update 对象后置空
	updateQueue.shared.pending = null;
	// 将原本的 state 和当前最新的 Update 对象进行比较，得到的结果是 ReactElementType 类型对象
	// 这里的 memoizedState 相当于 <App/> 的 ReactElementType 对象
	const { memoizedState } = processUpdateQueue(baseState, pending);
	// 将最新的 memoizedState 赋值给 wip 的 memoizedState 属性中
	wip.memoizedState = memoizedState;

	const nextChildren = wip.memoizedState;
	// 将 wip 和 nextChildren 传给 reconcileChildren 函数用于生成子节点的 fiberNode
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

// 针对 HostComponent 的 mount 逻辑
// 形如：<div><span><span/><div/> 节点，对于 div 节点来说，span 作为其 children，其信息处在 div 中的 pendingProps 中的 children 中
function updateHostComponent(wip: FiberNode) {
	// 获取 HostComponent 节点的 children 属性
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	// 传值给 reconcileChildren 用于生成子节点的 fiberNode
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
	const current = wip.alternate;

	if (current !== null) {
		// update
		wip.child = reconcileChildFibers(wip, current?.child, children);
	} else {
		// mount
		wip.child = mountChildFibers(wip, null, children);
	}
}
