// 递归中的递阶段

import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { FiberNode } from './fiber';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { Ref } from './fiberFlags';
import { pushProvider } from './fiberContext';

/**
 * fiber tree 中的 render 阶段的开始的递阶段
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param renderLane {Lane} 渲染优先级
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// 比较，并返回子 fiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);

		case HostComponent:
			return updateHostComponent(wip);

		case HostText:
			return null;

		case FunctionComponent:
			return updateFunctionComponent(wip, renderLane);

		case Fragment:
			return updateFragment(wip);

		case ContextProvider:
			return updateContextProvider(wip);

		default:
			if (__DEV__) {
				console.warn('beginWork为实现的类型');
			}
			break;
	}
	return null;
};

/**
 * 针对 Context.Provider 类型 Fiber 节点的 update 操作
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function updateContextProvider(wip: FiberNode) {
	// 这里的 providerType 其实就是 ReactProviderType 实例对象
	// {
	// 	$$typeof: REACT_PROVIDER_TYPE,
	// 	_context: context
	// }
	const providerType = wip.type;
	const context = providerType._context;
	const newProps = wip.pendingProps;

	// Context 入栈
	pushProvider(context, newProps.value);

	const nextChildren = newProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 针对 Fragment 类型 Fiber 节点的 update 操作
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function updateFragment(wip: FiberNode) {
	const nextChildren = wip.pendingProps;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 针对 FunctionComponent 类型 Fiber 节点的 update 操作
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param renderLane {Lane} 渲染优先级
 */
function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
	const nextChildren = renderWithHooks(wip, renderLane);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 针对 HostRoot 类型 Fiber 节点的 update 操作
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param renderLane {Lane} 渲染优先级
 */
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
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
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	// 将最新的 memoizedState 赋值给 wip 的 memoizedState 属性中
	wip.memoizedState = memoizedState;

	const nextChildren = wip.memoizedState;
	// 将 wip 和 nextChildren 传给 reconcileChildren 函数用于生成子节点的 fiberNode
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 针对 HostComponent 类型 Fiber 节点的 update 操作
 * 形如：<div><span><span/><div/> 节点，对于 div 节点来说，span 作为其 children，其信息处在 div 中的 pendingProps 中的 children 中
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function updateHostComponent(wip: FiberNode) {
	// 获取 HostComponent 节点的 children 属性
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	// 标记 Ref
	markRef(wip.alternate, wip);
	// 传值给 reconcileChildren 用于生成子节点的 fiberNode
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 协调算法，用于生成子节点的 fiberNode
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param children {ReactElementType} 子节点的 ReactElementType 实例对象
 */
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

/**
 * 标记 Ref
 * @param current {FiberNode | null} 当前页面 DOM 树对应的 Fiber 节点
 * @param workInProgress {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 */
function markRef(current: FiberNode | null, workInProgress: FiberNode) {
	// 获取当前的 ref
	const ref = workInProgress.ref;

	if (
		// mount 阶段，ref 不为空需要标记 Ref
		(current === null && ref !== null) ||
		// update 阶段，ref 不为空且 ref 和 current 中的 ref 不相等需要标记 Ref
		(current !== null && current.ref !== ref)
	) {
		workInProgress.flags |= Ref;
	}
}
