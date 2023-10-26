// 递归中的递阶段

import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import {
	createFiberFromFragment,
	createFiberFromOffscreen,
	createWorkInProgress,
	FiberNode,
	OffscreentProps
} from './fiber';
import { renderWithHooks } from './fiberHooks';
import { Lane, NoLanes } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	OffscreenComponent,
	SuspenseComponent
} from './workTags';
import {
	ChildDeletion,
	DidCapture,
	NoFlags,
	Placement,
	Ref
} from './fiberFlags';
import { pushProvider } from './fiberContext';
import { pushSuspenseHandler } from './suspenseContext';

/**
 * fiber tree 中的 render 阶段的开始的递阶段
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param renderLane {Lane} 渲染优先级
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// TODO: bailout 策略

	wip.lanes = NoLanes;

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

		case SuspenseComponent:
			return updateSuspenseComponent(wip);

		case OffscreenComponent:
			return updateOffscreenComponent(wip);

		default:
			if (__DEV__) {
				console.warn('beginWork为实现的类型');
			}
			break;
	}
	return null;
};

/**
 * 針對 Suspense 類型組件的 update 操作
 *
 * @param {FiberNode} wip - 當前工作單元
 * @returns {FiberNode} 返回當前工作單元的子節點
 */
function updateSuspenseComponent(wip: FiberNode): FiberNode {
	const current = wip.alternate;
	const nextProps = wip.pendingProps;

	// 變量，表示是否需要展示 fallback
	let showFallback = false;
	// 變量，表示是否掛起
	const didSuspend = (wip.flags & DidCapture) !== NoFlags;

	if (didSuspend) {
		// 掛起時，showFallback 應為 true
		showFallback = true;
		wip.flags &= ~DidCapture;
	}

	// 获取 OffScreen 的 ReactElement
	const nextPrimaryChildren = nextProps.children;
	// 获取 Fallback 的 ReactElement
	const nextFallbackChildren = nextProps.fallback;

	pushSuspenseHandler(wip);

	if (current === null) {
		// mount
		if (showFallback) {
			// 掛起
			return mountSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常
			return mountSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	} else {
		// update
		if (showFallback) {
			// 掛起
			return updateSuspenseFallbackChildren(
				wip,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常
			return updateSuspensePrimaryChildren(wip, nextPrimaryChildren);
		}
	}
}

/**
 * 針對 Suspense 組件下的 primary 組件的 update 階段的操作
 *
 * @param {FiberNode} wip - Suspense 組件對應的 FiberNode 實例對象
 * @param {any} primaryChildren - Suspense 組件下的 primary 組件的 ReactElementType
 * @returns {FiberNode} 返回 Suspense 組件下的 primary 組件對應的 FiberNode 實例對象
 */
function updateSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	// 获取 Suspense 在 current 树上的节点
	const current = wip.alternate as FiberNode;
	// 获取 Suspense 中的 OffScreen 对应在 current 树上的节点
	const currentPrimaryChildFragment = current.child as FiberNode;
	// 获取 Suspense 中的 Fallback 对应在 current 树上的节点，这里可能会有 null 的情况
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sidling;

	// 创建对应的 Props
	const primaryChildProps: OffscreentProps = {
		mode: 'visible',
		children: primaryChildren
	};

	// 复用 current 树上的节点
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);

	primaryChildFragment.return = wip;
	// 这里在 FiberNode 的层面上直接移除了跟 Fallback 的关系
	primaryChildFragment.sidling = null;
	wip.child = primaryChildFragment;

	// 因为上边在 FiberNode 中移除了跟 Fallback 的关系，所以这里要操作对应的标记，使得 DOM 可以同步
	if (currentFallbackChildFragment !== null) {
		const deletions = wip.deletions;
		if (deletions === null) {
			// 没有 deletions 则创建一个新的，并且添加对应的 FiberNode 和 ChildDeletion 的 flag
			wip.deletions = [currentFallbackChildFragment];
			wip.flags |= ChildDeletion;
		} else {
			// 有 deletions 则添加对应的 FiberNode
			deletions.push(currentFallbackChildFragment);
		}
	}

	return primaryChildFragment;
}

/**
 * 針對 Suspense 組件下的 fallback 組件在 update 階段的操作
 *
 * @param {FiberNode} wip - Suspense 組件的 FiberNode
 * @param {any} primaryChildren - Suspense 組件下的 primary 對應的 ReactElementType
 * @param {any} fallbackChildren - Suspense 組件下的 fallback 對應的 ReactElementType
 * @returns {FiberNode} 返回 Suspense 組件下的 fallback 組件對應的 FiberNode 實例對象
 */
function updateSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	// 获取 Suspense FiberNode 的 alternate
	const current = wip.alternate as FiberNode;
	// 获取 current.child 也就是说是 Suspense 下的 OffScreen 的 current 树上的节点
	const currentPrimaryChildFragment = current.child as FiberNode;
	// 获取 OffScreen 在 current 树上的节点的 sibling，其实就是 current 树上的 Fragment，注意，这里可以为空的
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sidling;

	const primaryChildProps: OffscreentProps = {
		mode: 'hidden',
		children: primaryChildren
	};

	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);
	let fallbackChildFragment;

	// 判断 currentFallbackChildFragment 是否存在
	if (currentFallbackChildFragment !== null) {
		// 存在则直接复用
		fallbackChildFragment = createWorkInProgress(
			currentFallbackChildFragment,
			fallbackChildren
		);
	} else {
		// 反之则直接创建一个
		fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
		fallbackChildFragment.flags |= Placement;
	}

	fallbackChildFragment.return = wip;
	primaryChildFragment.return = wip;
	primaryChildFragment.sidling = fallbackChildFragment;
	wip.child = primaryChildFragment;

	return fallbackChildFragment;
}

/**
 * 針對 Suspense 組件中的 primary 組件 mount 階段的操作
 *
 * @param {FiberNode} wip - Suspense 組件的 Fiber 節點
 * @param {any} primaryChildren - Suspense 組件下的 primary 組件的信息，一般是 ReactElementType 類型
 * @returns {FiberNode} 返回 primary 組件對應的 FiberNode 實例對象
 */
function mountSuspensePrimaryChildren(wip: FiberNode, primaryChildren: any) {
	const primaryChildProps: OffscreentProps = {
		mode: 'visible',
		children: primaryChildren
	};

	const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
	wip.child = primaryChildFragment;
	primaryChildFragment.return = wip;
	return primaryChildFragment;
}

/**
 * 針對 Suspense 中的 fallback 組件的 mount 階段的操作
 *
 * @param {FiberNode} wip - Suspense 組件的 Fiber 節點
 * @param {any} primaryChildren - Suspense 組件下的 primary 組件的信息，一般是 ReactElementType 類型
 * @param {any} fallbackChildren - Suspense 組件下的 fallback 組件的信息，一般是 ReactElementType 類型
 * @returns {FiberNode} 返回 fallback 組件對應的 FiberNode 實例對象
 */
function mountSuspenseFallbackChildren(
	wip: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const primaryChildProps: OffscreentProps = {
		mode: 'hidden',
		children: primaryChildren
	};

	const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
	const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);

	// 由於 fallbackChildren 處於 mount 階段的時候，整個組件樹其實是處在了 update 階段，所以此時 shouldTrackEffects 為 false，且 alternate 也不為 null
	// 所以此時需要手動標記一下 flags 為 Placement
	// 注意：只有在整個組件樹為 mount 階段的時候，shouldTrackEffects 才會為 true，且 alternate 為 null
	fallbackChildFragment.flags |= Placement;

	primaryChildFragment.return = wip;
	fallbackChildFragment.return = wip;
	primaryChildFragment.sidling = fallbackChildFragment;
	wip.child = primaryChildFragment;

	return fallbackChildFragment;
}

/**
 * 針對 OffscreenComponent 類型的 Fiber 節點的 update 操作
 *
 * @param {FiberNode} wip - 當前工作單元
 * @returns {FiberNode} 返回當前工作單元的子 Fiber 節點
 */
function updateOffscreenComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	const nextChildren = nextProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

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

	// 这里是防止 use Hook 没有包裹 Suspense 组件导致 fiber 树没有翻转
	// 可以看 createWorkInProgress 方法中，创建 wip 的逻辑是将 current 的 memoizedState 赋值给 wip 的 memoizedState 变量
	// 而这里由于 use Hook 的存在会导致 current 和 wip 树没有进行翻转，所以下次的 current 还是这次的 current 所以将需要更新 current 上的 memoizedState 变量
	const current = wip.alternate;
	if (current !== null) {
		current.memoizedState = memoizedState;
	}

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
