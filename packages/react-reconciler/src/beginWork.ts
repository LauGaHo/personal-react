// 递归中的递阶段

import { ReactElementType } from 'shared/ReactTypes';
import {
	cloneChildFibers,
	mountChildFibers,
	reconcileChildFibers
} from './childFibers';
import {
	createFiberFromFragment,
	createFiberFromOffscreen,
	createWorkInProgress,
	FiberNode,
	OffscreentProps
} from './fiber';
import { bailoutHook, renderWithHooks } from './fiberHooks';
import { includeSomeLanes, Lane, NoLanes } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	MemoComponent,
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
import { shallowEqual } from 'shared/shallowEquals';

// 代表是否可以命中 bailout 优化策略，false 表示命中 bailout；true 表示没有命中 bailout
let didReceiveUpdate = false;

/**
 * 标记本次更新没有命中 bailout 逻辑，走 update 逻辑
 *
 */
export function markWipReceivedUpdate() {
	didReceiveUpdate = true;
}

/**
 * fiber tree 中的 render 阶段的开始的递阶段
 * @param wip {FiberNode} 当前工作单元 (workInProgress 指针所指 Fiber 节点)
 * @param renderLane {Lane} 渲染优先级
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// bailout 策略
	// 每次 beginWork 都需要重置 didReceiveUpdate 为 false
	didReceiveUpdate = false;
	const current = wip.alternate;

	if (current !== null) {
		const oldProps = current.memoizedProps;
		const newProps = wip.pendingProps;

		// 这里选用四要素的比较来判断 bailout 优化逻辑条件的命中基于以下的点：
		// 1. type: 对于 FunctionComponent 来说，fiber.type 就是对应的函数
		// 2. Props: 对于 FunctionComponent 来说，Props 就相当于是函数传入的形参
		// 3. state: 对于 FunctionComponent 来说，state 就相当于于 useState Hook 中的值，而 state 改变必然伴随着 lanes
		// 4. context: TODO: 补充对应说明

		// 四要素比较之 Props 比较和 type 比较
		if (oldProps !== newProps || current.type !== wip.type) {
			didReceiveUpdate = true;
		} else {
			// Props 和 type 都相等，所以接下来比较 state 和 context
			const hasScheduledStateOrContext = checkScheduledUpdateOrContext(
				current,
				renderLane
			);

			if (!hasScheduledStateOrContext) {
				// 表示四要素中的 Context 和 state 不变
				// 此处 hasScheduledStateOrContext 为 false 表示命中了 bailout 优化策略
				// 命中 bailout
				didReceiveUpdate = false;

				// 考虑 Context 的入栈和出栈
				switch (wip.tag) {
					case ContextProvider:
						const newValue = wip.memoizedProps.value;
						const context = wip.type._context;
						pushProvider(context, newValue);
						break;
					// TODO: Suspense
				}

				// 这里需要进行一下说明，bailoutOnAlreadyFinishedWork 函数中有两个潜在可能的返回值：
				// 1. null: 返回 null 值时说明了 wip 下的所有子树符合 bailout 优化条件，所以返回 null 直接返回上一级进入 completeWork 流程
				// 2. FiberNode 实例对象: 说明 wip 下一级的子树满足 bailout 优化条件，所以返回下一级的 FiberNode，从下一级开始 beginWork
				return bailoutOnAlreadyFinishedWork(wip, renderLane);
			}
		}
	}

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
			return updateFunctionComponent(wip, wip.type, renderLane);

		case Fragment:
			return updateFragment(wip);

		case ContextProvider:
			return updateContextProvider(wip);

		case SuspenseComponent:
			return updateSuspenseComponent(wip);

		case OffscreenComponent:
			return updateOffscreenComponent(wip);

		case MemoComponent:
			return updateMemoComponent(wip, renderLane);

		default:
			if (__DEV__) {
				console.warn('beginWork为实现的类型');
			}
			break;
	}
	return null;
};

/**
 * bailout 具体逻辑，复用上次更新的结果
 *
 * @param {FiberNode} wip - 当前工作单元 FiberNode
 * @param {Lane} renderLane - 当前更新的优先级 renderLane
 */
function bailoutOnAlreadyFinishedWork(wip: FiberNode, renderLane: Lane) {
	// 能进入该函数，证明已经命中了 bailout 的优化策略
	// 首先先检查一下优化程度

	// 判断子树中的 lanes 也就是 childLanes 中是否包含本次更新的 renderLane
	if (!includeSomeLanes(wip.childLanes, renderLane)) {
		// 表示 wip 的子树也满足 bailout 优化策略
		if (__DEV__) {
			console.warn('bailout 整棵子树', wip);
		}
		// 这里返回 null 的原因表示 wip 下所有的子树都不需要进入 render 过程，所以直接返回 null
		return null;
	}

	// 来到这里表示，下边的子树中的某些 Component 存在跟本次更新优先级一样的 Update 实例对象
	if (__DEV__) {
		console.warn('bailout 一个 fiber', wip);
	}
	cloneChildFibers(wip);
	return wip.child;
}

/**
 * 检查当前 fiber 节点是否含有跟本次更新优先级相同优先级的待执行的 Update 实例对象
 *
 * @param {FiberNode} current - 当前 fiber 节点在 current 树上的节点，使用 current 而不用 wip 的原因在于，wip.lanes 在 beginWork 中被赋值为了 NoLanes 了
 * @param {Lane} renderLane - 本次更新的优先级 renderLane
 * @returns {boolean} 返回值为 true 表示含有，为 false 表示不含有
 */
function checkScheduledUpdateOrContext(
	current: FiberNode,
	renderLane: Lane
): boolean {
	const updateLanes = current.lanes;

	// 判断当前 Fiber 节点中待执行的 lanes 中是否包含本次更新的 renderLane
	if (includeSomeLanes(updateLanes, renderLane)) {
		// 当前 Fiber 中含有本次更新优先级的待执行的 Update 实例对象
		return true;
	}

	return false;
}

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
 * 针对 MemoComponent 类型的 Fiber 节点的 update 操作
 *
 * @param {FiberNode} wip - 当前工作单元
 * @param {Lane} renderLane - 当前更新的优先级
 */
function updateMemoComponent(wip: FiberNode, renderLane: Lane) {
	// bailout 四要素
	// props 浅比较
	const current = wip.alternate;
	const nextProps = wip.pendingProps;
	// 被 memo 包围的 Function Component 的函数
	const Component = wip.type.type;

	if (current !== null) {
		const prevProps = current.memoizedProps;

		// 浅比较
		if (shallowEqual(prevProps, nextProps) && current.ref === wip.ref) {
			// 表示可能命中了 bailout 逻辑
			didReceiveUpdate = false;
			wip.pendingProps = prevProps;
			// 比较 state 和 context
			if (!checkScheduledUpdateOrContext(current, renderLane)) {
				// 满足了四要素
				wip.lanes = current.lanes;
				return bailoutOnAlreadyFinishedWork(wip, renderLane);
			}
		}
	}
	return updateFunctionComponent(wip, Component, renderLane);
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
function updateFunctionComponent(
	wip: FiberNode,
	Component: FiberNode['type'],
	renderLane: Lane
) {
	// 执行 render 进行状态计算
	const nextChildren = renderWithHooks(wip, Component, renderLane);

	// 这里其实再给一个机会给这个 FunctionComponent 来进入 bailout 优化策略的
	// 如果本次 Update 计算出来的结果跟上次结果一致的话，则会直接进入 bailout 逻辑

	// 第一步中的状态计算可以知道是否命中了 bailout 逻辑
	const current = wip.alternate;
	// 注意这里的 didReceiveUpdate 比较关键，需要哪些地方对改变量进行了修改
	if (current !== null && !didReceiveUpdate) {
		// 命中了 bailout 优化策略
		bailoutHook(wip, renderLane);
		return bailoutOnAlreadyFinishedWork(wip, renderLane);
	}

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

	const prevChildren = wip.memoizedState;

	// 将原本的 state 和当前最新的 Update 对象进行比较，得到的结果是 ReactElementType 类型对象
	// 这里的 memoizedState 相当于 <App/> 的 ReactElementType 对象
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	// 将最新的 memoizedState 赋值给 wip 的 memoizedState 属性中
	wip.memoizedState = memoizedState;

	// 这里是防止 use Hook 没有包裹 Suspense 组件导致 fiber 树没有翻转
	// 可以看 createWorkInProgress 方法中，创建 wip 的逻辑是将 current 的 memoizedState 赋值给 wip 的 memoizedState 变量
	// 而这里由于 use Hook 的存在会导致 current 和 wip 树没有进行翻转，所以下次的 current 还是这次的 current 所以将需要更新 current 上的 memoizedState 变量
	const current = wip.alternate;
	if (current !== null) {
		if (!current.memoizedState) {
			current.memoizedState = memoizedState;
		}
	}

	const nextChildren = wip.memoizedState;
	// 这种情况同样认为是满足了 bailout 优化条件
	if (prevChildren === nextChildren) {
		return bailoutOnAlreadyFinishedWork(wip, renderLane);
	}
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
