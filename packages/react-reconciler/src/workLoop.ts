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
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_NormalPriority as NormalPriority
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';

let workInProgress: FiberNode | null = null;
// 记录本次更新的 Lane
let wipRootRenderLane: Lane = NoLane;
// 标记当前 fiberRootNode 在本次更新中是否含有 PassiveEffect
let rootDoesHasPassiveEffects = false;

function prepareFreshStack(root: FiberRootNode, lane: Lane) {
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
	// 如果当前是 NoLane，直接返回
	if (updateLane === NoLane) {
		return;
	}

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
	}
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

// render 阶段的入口
function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHighestPriorityLane(root.pendingLanes);

	if (nextLane !== SyncLane) {
		// 其他比 SyncLane 低的优先级
		// NoLane
		// 重新调一下 ensureRootIsScheduled 函数，如果是 NoLane 则直接返回，如果是比 SyncLane 低的优先级，就重新在 ensureRootIsScheduled 进行调度
		ensureRootIsScheduled(root);
		return;
	}

	if (__DEV__) {
		console.warn('render 阶段开始');
	}

	// 初始化
	prepareFreshStack(root, lane);

	// render 阶段
	do {
		try {
			workLoop();
			break;
		} catch (e) {
			if (__DEV__) {
				console.log(e);
			}
			workInProgress = null;
		}
	} while (true);

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
	// 遍历 FiberRootNode.pendingPassiveEffects 中的 unmount 属性中的 Effect 链表执行 unmount 操作
	// 注意：每一个 Effect 都需要执行 unmount 操作
	pendingPassiveEffects.unmount.forEach((effect) => {
		commitHookEffectListUnmount(Passive, effect);
	});

	// 置空 FiberRootNode.pendingPassiveEffects 中的 unmount 数组
	pendingPassiveEffects.unmount = [];

	// 遍历 FiberRootNode.pendingPassiveEffects 中的 update 属性中的 Effect 链表执行 destroy 操作
	// 注意：只有 Effect.tag 中同时含有 Passive 和 HookHasEffect 才能执行
	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});

	// 遍历 FiberRootNode.pendingPassiveEffects 中的 update 属性中的 Effect 链表
	// 注意：只有 Effect.tag 中同时含有 Passive 和 HookHasEffect 才能执行
	pendingPassiveEffects.update.forEach((effect) => {
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});

	// 清空 pendingPassiveEffects 中的 update 数组
	pendingPassiveEffects.update = [];

	// 由于回调函数执行的过程中，可能会触发到其他同步更新，所以在最后刷新执行一个同步任务的 callback
	flushSyncCallbacks();
}

function workLoop() {
	while (workInProgress !== null) {
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
