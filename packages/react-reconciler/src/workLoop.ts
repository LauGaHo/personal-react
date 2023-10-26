import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitLayoutEffects,
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
	getNextLane,
	Lane,
	lanesToSchedulerPriority,
	markRootFinished,
	markRootSuspend,
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
import { getSuspenseThenable, SuspenseException } from './thenable';
import { resetHooksOnUnwind } from './fiberHooks';
import { throwException } from './fiberThrow';
import { unwindWork } from './fiberUnwindWork';

let workInProgress: FiberNode | null = null;
// 记录本次更新的 Lane
let wipRootRenderLane: Lane = NoLane;
// 标记当前 fiberRootNode 在本次更新中是否含有 PassiveEffect
let rootDoesHasPassiveEffects = false;

// 标记 render 退出原因的变量
type RootExitStatus = number;
// 工作中的状态
const RootInProgress = 0;
// render 中断退出
const RootInComplete = 1;
// render 阶段完成退出
const RootCompleted = 2;
// 由于挂起，当前是未完成状态，不用进入 commit 阶段
const RootDidNotComplete = 3;
// 全局的退出状态
let wipRootExitStatus = RootInProgress;

type SuspendedReason = typeof NotSuspended | typeof SuspendedOnData;
// 没挂起
const NotSuspended = 0;
// 请求数据的挂起
const SuspendedOnData = 1;
// wip 被挂起的原因
let wipSuspendedReason: SuspendedReason = NotSuspended;
// 保存抛出的数据
let wipThrownValue: any = null;

/**
 * render 过程前的刷新程序执行的栈帧
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 * @param lane {Lane} 优先级
 */
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// 重置 FiberRootNode 相关属性
	root.finishedLane = NoLane;
	root.finishedWork = null;
	workInProgress = createWorkInProgress(root.current, {});
	// 每次更新前，都记录当前此次更新的优先级
	wipRootRenderLane = lane;
	// 为全局退出状态变量赋值为 RootInProgress 标识工作中
	wipRootExitStatus = RootInProgress;
	// 为全局变量 wip 被挂起的原因赋值为 NotSuspended 标识没有被挂起
	wipSuspendedReason = NotSuspended;
	// 置空 wip 遇到 Suspended 所抛出的数据
	wipThrownValue = null;
}

/**
 * 调度执行 render 过程的入口
 * @param fiber {FiberNode} 触发 render 的 Fiber 节点
 * @param lane {Lane} 优先级
 */
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// TODO 调度功能
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	// 进入 schedule 阶段
	ensureRootIsScheduled(root);
}

/**
 * schedule 阶段入口
 * @param root {FiberRootNode} fiber 树的根节点
 */
export function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取当前最高的优先级
	const updateLane = getNextLane(root);
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

	if (__DEV__) {
		console.log(
			`在${updateLane === SyncLane ? '微' : '宏'}任务中调度，优先级：`,
			updateLane
		);
	}

	if (updateLane === SyncLane) {
		// 同步优先级，用微任务调度
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

/**
 * 将当前新增的优先级合并到 FiberRootNode 中的 pendingLanes
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 * @param lane {Lane} 优先级
 */
export function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

/**
 * 给定一个 fiberNode，向上遍历直到找到 hostRootFiber
 * @param fiber {FiberNode} Fiber 节点，一般为触发更新的 Fiber 节点
 */
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

/**
 * 并发更新的入口
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 * @param didTimeout {boolean} 是否超时
 */
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	// 保证 useEffect 回调执行
	const curCallback = root.callbackNode;
	// 刷新当前所有的 useEffect 回调，并返回一个 boolean 类型的值，标识是否执行了 useEffect 回调
	// 这里需要执行一遍 flushPassiveEffects 的原因在于，在 commit 阶段，flushPassiveEffects 是被调度器 Scheduler 用 NormalPriority 优先级调度的
	// 但是有可能 commit 阶段完了之后，还有比 NormalPriority 优先级更高的 render 任务，就会导致 useEffect 回调没有执行，所以需要保证下一次 commit 之前，要清空上一次的 useEffect 回调，所以这里才会再执行了一次 flushPassiveEffects
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
	const lane = getNextLane(root);
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
	// 下边的那行代码搬到了 RootDidNotComplete 的 switch 分支上
	// ensureRootIsScheduled(root);

	switch (exitStatus) {
		// 因为并发更新打断了
		case RootInComplete:
			// 代表有一个更高优先级的任务
			if (root.callbackNode !== curCallbackNode) {
				return null;
			}
			// 代表还是调度当前正在处理的任务，即同等优先级
			// 结合着 ensureRootIsScheduled 函数来说，这里算是 scheduler 的一个优化路径
			return performConcurrentWorkOnRoot.bind(null, root);

		// render 阶段结束了
		case RootCompleted:
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
			break;

		// render 阶段没有完成，好比 use Hook 没有被 Suspense 包围
		case RootDidNotComplete:
			wipRootRenderLane = NoLane;
			// 标记当前更新的 Lane 被挂起了
			markRootSuspend(root, lane);
			ensureRootIsScheduled(root);
			break;

		default:
			if (__DEV__) {
				console.error('还未实现的并发更新结束状态');
			}
			break;
	}
}

/**
 * 同步更新的入口
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 */
function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getNextLane(root);

	if (nextLane !== SyncLane) {
		// 其他比 SyncLane 低的优先级
		// NoLane
		// 重新调一下 ensureRootIsScheduled 函数，如果是 NoLane 则直接返回，如果是比 SyncLane 低的优先级，就重新在 ensureRootIsScheduled 进行调度
		ensureRootIsScheduled(root);
		return;
	}

	const exitStatus = renderRoot(root, nextLane, false);

	switch (exitStatus) {
		case RootCompleted:
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
			break;

		case RootDidNotComplete:
			wipRootRenderLane = NoLane;
			markRootSuspend(root, nextLane);
			ensureRootIsScheduled(root);
			break;

		default:
			if (__DEV__) {
				console.log('还未实现的同步更新结束状态');
			}
			break;
	}
}

/**
 * render 阶段的逻辑，分为同步和并发
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 * @param lane {Lane} 优先级
 * @param shouldTimeSlice {boolean} 是否需要切片
 */
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
			// 判断当前是否处于 Suspense 挂起状态，并且 wip 不为空
			if (wipSuspendedReason !== NotSuspended && workInProgress !== null) {
				// 需要进入 unwind 流程
				// 获取抛出的错误
				const thrownValue = wipThrownValue;
				wipSuspendedReason = NotSuspended;
				// 置空 wipThrownValue
				wipThrownValue = null;
				// 進入 unwind 操作
				throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
			}

			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			handleThrow(root, e);
		}
	} while (true);

	if (wipRootExitStatus !== RootInProgress) {
		return wipRootExitStatus;
	}

	// 执行到这里有两种可能性
	// 中断执行 || render 阶段执行完毕
	if (shouldTimeSlice && workInProgress !== null) {
		// 命中中断执行的可能性
		return RootInComplete;
	}

	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		console.error(`render 阶段结束时 wip 不应该是 null`);
	}
	// TODO: 报错的可能性
	return RootCompleted;
}

function throwAndUnwindWorkLoop(
	root: FiberRootNode,
	unitOfWork: FiberNode,
	throwValue: any,
	lane: Lane
) {
	// 重置 FunctionComponent 全局變量
	resetHooksOnUnwind();
	// 請求返回重新觸發更新
	// 通过将 thenable 包装成 wakeable，然后绑定对应的 then 回调即可
	throwException(root, throwValue, lane);
	// unwind
	unwindUnitOfWork(unitOfWork);
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
	// 抛出错误组件对应的 FiberNode 实例对象
	let incompleteWork: FiberNode | null = unitOfWork;

	do {
		const next = unwindWork(incompleteWork);

		// 找到了对应的 Suspense FiberNode
		if (next !== null) {
			// next.flags &= HostEffectMask;
			// 将 wip 赋值为对应的 Suspense FiberNode，然后直接 return 不用执行下边的了
			// 返回了之后就会继续执行 beginWork 并且 wip 此时就是 Suspense FiberNode
			workInProgress = next;
			return;
		}

		// 来到这里就说明了还没找到，所以继续往上找
		const returnFiber = incompleteWork.return as FiberNode;
		if (returnFiber !== null) {
			// 因為需要重新進行 beginWork，所以先把 deletion 先刪了，清除副作用
			returnFiber.deletions = null;
		}
		incompleteWork = returnFiber;
		// 这里的 while 条件是一直往上找，知道找到对应的 Suspense FiberNode
	} while (incompleteWork !== null);

	// 走到了這裡說明，使用了 use Hook，並拋出了 data，但是沒有定義 SuspenseComponent
	// 找到了 root 了
	// 没找到对应的 Suspense FiberNode，将 wipRootExitStatus 赋值为 RootDidNotComplete 并且置空 workInProgress 变量
	wipRootExitStatus = RootDidNotComplete;
	workInProgress = null;
}

function handleThrow(root: FiberRootNode, throwValue: any) {
	// Error Boundary

	// SuspenseException
	if (throwValue === SuspenseException) {
		// 这里是需要拿到 thenable
		throwValue = getSuspenseThenable();
		wipSuspendedReason = SuspendedOnData;
	}

	wipThrownValue = throwValue;
}

/**
 * 提交到 commit 阶段
 * @param root {FiberRootNode} FiberRootNode 节点，可以理解为 Fiber 树的根节点
 */
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
		// mutation 阶段
		commitMutationEffects(finishedWork, root);

		// fiber 树的切换
		root.current = finishedWork;

		// layout 阶段
		commitLayoutEffects(finishedWork, root);
	} else {
		root.current = finishedWork;
	}

	rootDoesHasPassiveEffects = false;
	// 确保 root 节点上任何一个其他额外的任务都能被调度
	ensureRootIsScheduled(root);
}

/**
 * 执行所有的 useEffect 回调函数，这个函数执行完，代表没有任何的 useEffect 没被执行
 * @param pendingPassiveEffects {PendingPassiveEffects} 正在 pending 阶段等待执行的 Effect 链表
 */
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

/**
 * 同步执行 workLoop 函数
 */
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 并发切片执行 workLoop 函数
 */
function workLoopConcurrent() {
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 构造 fiber 树的入口函数
 * @param fiber {FiberNode} workInProgress 指针对应指向的 fiber 节点
 */
function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;

	if (next === null) {
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}

/**
 * fiber 树构造的归阶段
 * @param fiber {FiberNode} workInProgress 指针对应指向的 fiber 节点
 */
function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;

	do {
		completeWork(node);
		const sibling = node.sidling;

		// 当前 sibling 对应的 fiber 节点不为空，说明 fiber 形参的旁边仍有 fiber 节点
		if (sibling !== null) {
			// 将全局变量 workInProgress 赋值为 sibling，用于进入下一个 beginWork 循环构造
			workInProgress = sibling;
			return;
		}
		// 反之则一层一层往上赋值，对其父节点及其祖先节点都进行 completeWork 函数的调用操作
		node = node.return;
		// 更新全局变量 workInProgress
		workInProgress = node;
	} while (node !== null);
}
