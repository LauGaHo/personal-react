import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	createWorkInProgress,
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects
} from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
	getHighestPriorityLane,
	Lane,
	lanesToSchedulerPriority,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_NormalPriority as NormalPriority,
	unstable_shouldYield,
	unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';

let workInProgress: FiberNode | null = null;
// 记录本次更新的 Lane
let wipRootRenderLane: Lane = NoLane;
// 标记当前 fiberRootNode 在本次更新中是否含有 PassiveEffect
let rootDoesHasPassiveEffects = false;

// 标记 render 退出原因的变量
type RootExitStatus = number;
// render 中断退出
const RootInComplete = 1;
// render 阶段完成退出
const RootCompleted = 2;
// TODO 执行过程中报错了

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// 重置 FiberRootNode 相关属性
	root.finishedLane = NoLane;
	root.finishedWork = null;
	workInProgress = createWorkInProgress(root.current, {});
	// 每次更新前，都记录当前此次更新的优先级
	wipRootRenderLane = lane;
}

export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// TODO 调度功能
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	// 进入 schedule 阶段
	ensureRootIsScheduled(root);
}

// schedule 阶段入口
function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取当前最高的优先级
	const updateLane = getHighestPriorityLane(root.pendingLanes);
	// 获取上一次任务的回调
	const existingCallback = root.callbackNode;
	// 如果当前是 NoLane，直接返回
	// 标志当前没有任务需要调度执行
	if (updateLane === NoLane) {
		if (existingCallback !== null) {
			// 取消正在调度的任务
			unstable_cancelCallback(existingCallback);
		}
		// 置空 callbackNode 和 callbackPriority 并直接返回
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}

	// 将当前调度的任务的优先级赋值给 curPriority 变量
	const curPriority = updateLane;
	// 将 root 节点的 callbackPriority 赋值给 prePriority 变量
	const prePriority = root.callbackPriority;

	// 如果两次调度产生的优先级相同，则直接 return 返回，不需要做其他操作
	if (curPriority === prePriority) {
		return;
	}

	// 本次调度产生的优先级比上一次调度产生的优先级要高
	if (existingCallback !== null) {
		// 所以需要取消上一次被调度执行的任务
		unstable_cancelCallback(existingCallback);
	}
	// 声明 newCallbackNode 变量，用于承接调度器所产生的调度结果
	let newCallbackNode = null;

	if (updateLane === SyncLane) {
		// 同步优先级，用微任务调度
		if (__DEV__) {
			console.log('在微任务中调度，优先级：', updateLane);
		}
		// 调度任务阶段
		// [performSyncWorkOnRoot, performSyncWorkOnRoot, performSyncWorkOnRoot]
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		// 消费调度任务阶段
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级，用宏任务调度
		// 将当前的 Lane 优先级转换成 scheduler 对应的优先级
		const schedulerPriority = lanesToSchedulerPriority(updateLane);
		// 交给调度器来调度对应的回调，并把返回结果交给 newCallbackNode 变量
		newCallbackNode = scheduleCallback(
			schedulerPriority,
			// @ts-ignore
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}
	// 更新 root 中关于 concurrent 更新的相关变量
	root.callbackNode = newCallbackNode;
	root.callbackPriority = curPriority;
}

// 将当前新增的优先级合并到 FiberRootNode 中的 pendingLanes
function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 给定一个 fiberNode，向上遍历直到找到 hostRootFiber
function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber;
	let parent = node.return;
	while (parent !== null) {
		node = parent;
		parent = node.return;
	}
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
}

// 并发更新
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	// 保证 useEffect 回调执行
	const curCallback = root.callbackNode;
	// 刷新当前所有的 useEffect 回调，并返回一个 boolean 类型的值，标识是否执行了 useEffect 回调
	const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
	// 若执行了 useEffect 回调，则需要观察执行回调时有无产生新的调度任务
	// 此时如果 root.callbackNode !== curCallback 满足，说明在 useEffect 回调执行的时候产生了比当前任务更高优先级的任务
	if (didFlushPassiveEffect) {
		// 代表在执行 useEffect 回调的过程中，产生了优先级更高的任务，所以需要返回 null，停止执行当前的任务
		if (root.callbackNode !== curCallback) {
			return null;
		}
	}

	// 获取当前 root 节点中最高优先级
	const lane = getHighestPriorityLane(root.pendingLanes);
	// 获取当前调度器正在调度的任务
	const curCallbackNode = root.callbackNode;
	// 若当前最高的优先级为 NoLane，则直接返回
	if (lane === NoLane) {
		return null;
	}
	const needSync = lane === SyncLane || didTimeout;
	// render 阶段
	const exitStatus = renderRoot(root, lane, !needSync);

	// 走到了这里有两种可能性：
	// 1. concurrent 任务被中断了执行
	// 2. 任务执行完毕
	// 这里再次执行 ensureRootIsScheduled 一次的作用是：如果实际结果为可能性 1 的话，重新调度一下，看一下有没有产生更高优先级的任务，如果有，则直接返回，如果没有，则直接返回该函数本身
	ensureRootIsScheduled(root);

	// 可能性 1: 任务中断
	if (exitStatus === RootInComplete) {
		// 代表有一个更高优先级的任务
		if (root.callbackNode !== curCallbackNode) {
			return null;
		}
		// 代表还是调度当前正在处理的任务，即同等优先级
		// 结合着 ensureRootIsScheduled 函数来说，这里算是 scheduler 的一个优化路径
		return performConcurrentWorkOnRoot.bind(null, root);
	}

	// 可能性 2: 更新完毕
	if (exitStatus === RootCompleted) {
		// 获取 render 阶段形成的一棵完整的 fiberNode 树，并赋值给 root.finishedWork 属性中
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		// 记录本次消费的 Lane
		root.finishedLane = lane;
		// 更新结束之后，重新将 wipRootRenderLane 赋值为 NoLane
		wipRootRenderLane = NoLane;

		// commit 阶段
		// 根据 wip fiberNode 树中的 flags 提交给 render
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的并发更新结束状态');
	}
}

// 同步更新的入口
function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getHighestPriorityLane(root.pendingLanes);

	if (nextLane !== SyncLane) {
		// 其他比 SyncLane 低的优先级
		// NoLane
		// 重新调一下 ensureRootIsScheduled 函数，如果是 NoLane 则直接返回，如果是比 SyncLane 低的优先级，就重新在 ensureRootIsScheduled 进行调度
		ensureRootIsScheduled(root);
		return;
	}

	const exitStatus = renderRoot(root, nextLane, false);

	// 任务完成
	if (exitStatus === RootCompleted) {
		// 获取 render 阶段形成的一棵完整的 fiberNode 树，并赋值给 root.finishedWork 属性中
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		// 记录本次消费的 Lane
		root.finishedLane = nextLane;
		// 更新结束之后，重新将 wipRootRenderLane 赋值为 NoLane
		wipRootRenderLane = NoLane;

		// commit 阶段
		// 根据 wip fiberNode 树中的 flags 提交给 render
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的同步更新结束状态');
	}
}

// render 阶段的逻辑，分为同步和并发
function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
	}

	// 如果当前更新传入的 lane 优先级不等于上一次更新的 lane，才需要执行 prepareFreshStack 函数
	// 否则就相当于执行同一个任务而已，就不需要执行 prepareFreshStack 函数
	if (wipRootRenderLane !== lane) {
		// 初始化
		prepareFreshStack(root, lane);
	}

	do {
		try {
			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			workInProgress = null;
		}
	} while (true);

	// 执行到这里有两种可能性
	// 中断执行 || render 阶段执行完毕
	if (shouldTimeSlice && workInProgress !== null) {
		// 命中中断执行的可能性
		return RootInComplete;
	}

	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		console.error(`render 阶段结束时 wip 不应该是 null`);
	}
	// TODO 报错的可能性
	return RootCompleted;
}

// 提交到 commit 阶段
function commitRoot(root: FiberRootNode) {
	// 使用临时变量 finishedWork 存放 root.finishedWork
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}

	// 临时变量记录此次更新的优先级 lane
	const lane = root.finishedLane;

	if (lane === NoLane && __DEV__) {
		console.error('commit 阶段 finishedLane 不应该是 NoLane');
	}

	// 重置操作
	root.finishedWork = null;
	root.finishedLane = NoLane;

	// 如果 fiber.flags 中存在 PassiveMask 或者 fiber.flags 中存在 PassiveMask，则进入 if 语句调度副作用
	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subtreeFlags & PassiveMask) !== NoFlags
	) {
		if (!rootDoesHasPassiveEffects) {
			// 标记本次更新中，fiberRootNode 含有 PassiveEffect 副作用
			rootDoesHasPassiveEffects = true;
			// 调度副作用，执行需要执行的副作用 Effect 的回调函数，此处 scheduleCallback 作用相当于 setTimeout
			scheduleCallback(NormalPriority, () => {
				// 执行副作用
				flushPassiveEffects(root.pendingPassiveEffects);
				return;
			});
		}
	}

	// 从 FiberRootNode.pendingLanes 中移除本次更新的 lane
	markRootFinished(root, lane);

	// 判断是否存在 3 个子阶段需要执行的操作
	// 这里需要判断两项，分别是：root.flags 和 root.subtreeFlags
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;

	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation
		// mutation 执行 Placement 对应的操作
		commitMutationEffects(finishedWork, root);

		root.current = finishedWork;

		// layout
	} else {
		root.current = finishedWork;
	}

	rootDoesHasPassiveEffects = false;
	// 确保 root 节点上任何一个其他额外的任务都能被调度
	ensureRootIsScheduled(root);
}

// 执行所有的 useEffect 回调函数，这个函数执行完，代表没有任何的 useEffect 没被执行
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	let didFlushPassiveEffect = false;
	// 遍历 FiberRootNode.pendingPassiveEffects 中的 unmount 属性中的 Effect 链表执行 unmount 操作
	// 注意：每一个 Effect 都需要执行 unmount 操作
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});

	// 置空 FiberRootNode.pendingPassiveEffects 中的 unmount 数组
	pendingPassiveEffects.unmount = [];

	// 遍历 FiberRootNode.pendingPassiveEffects 中的 update 属性中的 Effect 链表执行 destroy 操作
	// 注意：只有 Effect.tag 中同时含有 Passive 和 HookHasEffect 才能执行
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});

	// 遍历 FiberRootNode.pendingPassiveEffects 中的 update 属性中的 Effect 链表
	// 注意：只有 Effect.tag 中同时含有 Passive 和 HookHasEffect 才能执行
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});

	// 清空 pendingPassiveEffects 中的 update 数组
	pendingPassiveEffects.update = [];

	// 由于回调函数执行的过程中，可能会触发到其他同步更新，所以在最后刷新执行一个同步任务的 callback
	flushSyncCallbacks();

	// 返回一个标识，标识当前有无执行 useEffect 的回调函数
	return didFlushPassiveEffect;
}

// 同步执行 workLoop 函数
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

// 并发切片执行 workLoop 函数
function workLoopConcurrent() {
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;

	if (next === null) {
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;

	do {
		completeWork(node);
		const sibling = node.sidling;

		if (sibling !== null) {
			workInProgress = sibling;
			return;
		}
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
