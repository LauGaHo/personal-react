import { Dispatcher, Dispatch } from 'react/src/currentDispatcher';
import currentBatchConfig from 'react/src/currentBatchConfig';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
	Update,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

// 当前正在 render 的 fiberNode
let currentlyRenderingFiber: FiberNode | null = null;
// 当前正在处理的 fiberNode 对应的 Hook
let workInProgressHook: Hook | null = null;
// update 阶段时，指代当前 fiberNode 的某个 Hook 实例对象对应在 current 树上的 Hook 实例对象
let currentHook: Hook | null = null;
// 当前正在处理的优先级
let renderLane: Lane = NoLane;

// 从 shared 中引入 internals 文件中的 currentDispatcher
// currentDispatcher 指代当前应用中指向的 Hook 链表上下文
const { currentDispatcher } = internals;

// 定义 Hook 实例对象
interface Hook {
	// 上次更新计算的最终 state
	memoizedState: any;
	updateQueue: unknown;
	next: Hook | null;
	// 本次更新参与计算的初始值 state
	baseState: any;
	// 下次更新时需要处理的 update 链表
	baseQueue: Update<any> | null;
}

export interface Effect {
	// 用于区分 useEffect, useInsertionEffect, useLayoutEffect
	tag: Flags;
	// useEffect 传入回调函数
	create: EffectCallback | void;
	// useEffect 传入回调函数所返回的函数
	destroy: EffectCallback | void;
	// 当前 useEffect 所需要的依赖
	deps: EffectDeps;
	// 指向下一个 Effect 实例对象
	next: Effect | null;
}

// 声明 FCUpdateQueue 类型
export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
}

// 声明 useEffect 回调函数的类型 EffectCallback
type EffectCallback = () => void;
// 声明 useEffect 所需的依赖的类型 EffectDeps
type EffectDeps = any[] | null;

// render 阶段对函数组件中的 Hook 的处理
export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 执行赋值操作
	currentlyRenderingFiber = wip;
	// 重置操作，重置 hooks 链表
	wip.memoizedState = null;
	// 重置 effect 链表
	wip.updateQueue = null;
	// 将传入函数的 lane 赋值给全局变量 renderLane
	renderLane = lane;

	const current = wip.alternate;

	if (current !== null) {
		// update
		currentDispatcher.current = HookDispatcherOnUpdate;
	} else {
		// mount
		currentDispatcher.current = HooksDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	const children = Component(props);

	// 重置操作 (重置一些全局变量)
	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

// mount 阶段对应的 HookDispatcher
const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect,
	useTransition: mountTransition,
	useRef: mountRef
};

// update 阶段对应的 HookDispatcher
const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect,
	useTransition: updateTransition,
	useRef: updateRef
};

// mount 阶段 useRef 钩子实现
function mountRef<T>(initialValue: T): { current: T } {
	// 创建一个 useRef 对应的 Hook 实例对象
	const hook = mountWorkInProgressHook();
	// 创建一个对象，其中 current 属性指向传入的 initialValue
	const ref = { current: initialValue };
	// 将 ref 赋值给 Hook 实例对象的 memoizedState 属性
	hook.memoizedState = ref;
	// 返回 ref 对象
	return ref;
}

// update 阶段 useRef 钩子实现
function updateRef<T>(initialValue: T): { current: T } {
	// 获取当前正在处理的 Hook 实例对象
	const hook = updateWorkInProgressHook();
	// 返回 Hook 实例对象的 memoizedState 属性
	return hook.memoizedState;
}

// mount 阶段 useTransition 钩子实现
function mountTransition(): [boolean, (callback: () => void) => void] {
	// 创建一个 state 并且命名为 isPending 变量
	const [isPending, setPending] = mountState(false);
	// 为 useTransition 创建了一个 hook 实例对象并形成一个 hook 链表
	const hook = mountWorkInProgressHook();
	// 将 startTransition 绑定内置的 useState 对应的 dispatch 方法
	const start = startTransition.bind(null, setPending);
	hook.memoizedState = start;
	return [isPending, start];
}

// useTransition 返回的方法
function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
	// 先触发一次高优先级的同步更新
	setPending(true);
	// 先获取之前的 transition 对应的值
	const prevTransition = currentBatchConfig.transition;
	// 再将对应的 transition 修改，1 标志为进入了 transition
	currentBatchConfig.transition = 1;

	callback();
	setPending(false);

	currentBatchConfig.transition = prevTransition;
}

// mount 阶段下 useEffect 对应的 Dispatch
function mountEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	// 创建一个 Hook 实例对象
	const hook = mountWorkInProgressHook();
	// 获取传入的 deps 依赖
	const nextDeps = deps === undefined ? null : deps;
	// 为当前 FiberNode 的 flags 属性赋值为 PassiveEffect，标记着当前 fiberNode 本次更新存在副作用
	(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;

	// 根据已有的信息构建一个 Effect 实例对象，并和已有的 Effect 实例对象形成环形链表
	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}

// update 阶段下的 useTransition 实现
function updateTransition(): [boolean, (callback: () => void) => void] {
	// 由于 useTransition 中内嵌了一个 useState，所以在 updateTransition 中先获取对应的 useState 的 hook，再获取 useTransition 对应的 hook
	const [isPending] = updateState();
	// 获取 useTransition 对应的 hook 实例对象
	const hook = updateWorkInProgressHook();
	// 获取 useTransition 钩子中对应的 startTransition 方法
	const start = hook.memoizedState;
	return [isPending as boolean, start];
}

// update 阶段下 useEffect 对应的 Dispatch
function updateEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	// 获取可复用的 Hook 实例对象
	const hook = updateWorkInProgressHook();
	// 规范化 deps 参数
	const nextDeps = deps === undefined ? null : deps;
	// 声明变量 destroy 的类型
	let destroy: EffectCallback | void;

	if (currentHook !== null) {
		// 获取 current 树上和本 Effect 与之对应的 Effect 实例对象
		const prevEffect = currentHook.memoizedState as Effect;
		// 获取 current 树上 Effect 实例对象的 destroy 属性
		destroy = prevEffect.destroy;

		if (nextDeps !== null) {
			// 浅比较依赖
			// 获取 current 树上 Effect 实例对象中的 deps 属性
			const prevDeps = prevEffect.deps;
			// 浅比较，相等
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
		}
		// 浅比较，不相等
		(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
		// 浅比较依赖是否相等的一个最大的作用就是，依赖相等则 tag 只有 Passive；依赖不等则 tag 是 Passive | HookHasEffect
		hook.memoizedState = pushEffect(
			Passive | HookHasEffect,
			create,
			destroy,
			nextDeps
		);
	}
}

// 比较 useEffect 这个 Hook 的依赖是否相等，通过浅比较
function areHookInputsEqual(nextDeps: EffectDeps, prevDeps: EffectDeps) {
	if (prevDeps === null || nextDeps === null) {
		return false;
	}

	// 通过遍历，比较 prevDeps 和 nextDeps 中的元素是否全等
	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}
	return true;
}

// 构建一个 Effect 实例对象，并跟已有的 Effect 对象形成一条闭环的链表(Effect 环形链表存放在 FiberNode.updateQueue 中)，并最终返回最新的 Effect 实例对象
function pushEffect(
	hookFlag: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: EffectDeps
): Effect {
	// 构建一个 Effect 实例对象
	const effect: Effect = {
		tag: hookFlag,
		create,
		destroy,
		deps,
		next: null
	};
	// 获取当前正在处理的 fiber 对象
	const fiber = currentlyRenderingFiber as FiberNode;
	// 获取 fiber 对象中的 updateQueue 属性
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	// updateQueue 为空
	if (updateQueue === null) {
		// 创建一个 FCUpdateQueue 并赋值为 updateQueue 变量
		const updateQueue = createFCUpdateQueue();
		// 将名为 updateQueue 的 FCUpdateQueue 对象赋值为 fiber.updateQueue
		fiber.updateQueue = updateQueue;
		// 将单一的一个 Effect 行成一条闭环的链表
		effect.next = effect;
		// 将 FCUpdateQueue 的 lastEffect 指向 Effect 实例对象
		updateQueue.lastEffect = effect;
	} else {
		// 插入 effect
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			// 一般不会出现这种情况，因为上边已经处理了，这里只是以防万一
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			// 获取 effect 链表中第一个 effect
			const firstEffect = lastEffect.next;
			// 将次新的 effect 的 next 指针指向最新的 effect 实例对象
			lastEffect.next = effect;
			// 将最新的 effect 的 next 指针指向第一个 effect 实例对象
			effect.next = firstEffect;
			// 将 updateQueue 的 lastEffect 指向最新的 effect
			updateQueue.lastEffect = effect;
		}
	}
	return effect;
}

// 创建一个 FCUpdateQueue 实例对象
function createFCUpdateQueue<State>() {
	// 通过 createUpdateQueue 创建一个队列，并将创建出来的对象作为 FCUpdateQueue 来看待
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
	// 为 updateQueue.lastEffect 属性赋值
	updateQueue.lastEffect = null;
	return updateQueue;
}

// update 阶段 useState 对应的 Dispatch
function updateState<State>(): [State, Dispatch<State>] {
	// 为当前正在 mount 的 fiber 创建对应 Hook 链，并返回当前 Hook 实例对象
	const hook = updateWorkInProgressHook();

	// 计算当前 useState 的 Hook 的最新值并赋值到 memoizedState 变量中
	const queue = hook.updateQueue as UpdateQueue<State>;
	// 获取当前 hook 实例对象中的 baseState
	const baseState = hook.baseState;

	// 获取当前 hook 中的 pendingUpdate 链表
	const pending = queue.shared.pending;
	// 将 currentHook 赋值为 current，这里的 current 指代的是 current 树上对应的 hook 实例对象
	const current = currentHook as Hook;
	// 在 current 树上对应的 hook 实例对象上拿到 baseQueue 属性
	let baseQueue = current.baseQueue;

	if (pending !== null) {
		// pendingUpdate 和 baseQueue 合并的解雇需要保存在 current 树中，防止更新被中断，下次更新再次从 current 中寻找对应的 update 实例对象
		if (baseQueue !== null) {
			// 将 pendingUpdate 和 baseQueue 进行合并操作
			// baseQueue -> b2 -> b0 -> b1 -> b2
			// pending -> p2 -> p0 -> p1 -> p2
			// baseFirst = b0
			const baseFirst = baseQueue.next;
			// pendingFirst = p0
			const pendingFirst = pending.next;
			// b2 -> p0
			baseQueue.next = pendingFirst;
			// p2 -> b0
			pending.next = baseFirst;
			// p2 -> b0 -> b1 -> b2 -> p0 -> p1 -> p2
		}
		// 此时的 pending 就是合并完成的结果
		baseQueue = pending;
		// 将 baseQueue 保存在 current 中
		current.baseQueue = pending;
		// 此时可以将 queue 中的 update 链表置空，因为已经存放在 current 中了
		queue.shared.pending = null;
	}

	// 为了避免 pending 属性为空的时候，无法正确计算 state 的值，所以需要将计算 state 值的代码移出 if (pending !== null) 条件判断
	if (baseQueue !== null) {
		// 计算新值
		const {
			memoizedState,
			baseQueue: newBaseQueue,
			baseState: newBaseState
		} = processUpdateQueue(baseState, baseQueue, renderLane);
		// 并将返回的 memoizedState, baseState, baseQueue 赋值到 hook 对应的变量中
		hook.memoizedState = memoizedState;
		hook.baseState = newBaseState;
		hook.baseQueue = newBaseQueue;
	}

	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

// update 阶段复用 current 树中对应的 Hook
function updateWorkInProgressHook(): Hook {
	// TODO render 阶段触发的更新
	// 存放 currentHook 的下一个 Hook 对象
	let nextCurrentHook: Hook | null;

	if (currentHook === null) {
		// 这是 FC Component update 时的第一个 Hook
		// 获取当前正在 render 操作的 FiberNode 节点对应在 current 树上的 FiberNode 节点
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			// 获取 current 树上的 FiberNode 节点并赋值给 nextCurrentHook 变量
			nextCurrentHook = current?.memoizedState;
		} else {
			// 置空 nextCurrentHook
			nextCurrentHook = null;
		}
	} else {
		// 这个 FC Component update 时后续的 Hook
		nextCurrentHook = currentHook.next;
	}

	if (nextCurrentHook === null) {
		// mount/update hook1 hook2 hook3
		// update       hook1 hook2 hook3 hook4
		throw new Error(
			`组件${currentlyRenderingFiber?.type}本次执行时的 Hook 比上次执行时多`
		);
	}

	// 将 nextCurrentHook 赋值给当前的 currentHook
	currentHook = nextCurrentHook as Hook;
	// 创建新的 Hook 实例，并复用 currentHook 中的信息
	const newHook: Hook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		next: null,
		baseQueue: currentHook.baseQueue,
		baseState: currentHook.baseState
	};
	if (workInProgressHook === null) {
		// update 时，第一个 hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用 hook');
		} else {
			workInProgressHook = newHook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// update 时，后续的 hook 将形成链表
		workInProgressHook.next = newHook;
		workInProgressHook = newHook;
	}
	return workInProgressHook;
}

// mount 阶段 useState 对应的 Dispatch
function mountState<State>(
	initialState: (() => State) | State
): [State, Dispatch<State>] {
	// 为当前正在 mount 的 fiber 创建对应 Hook 链，并返回当前 Hook 实例对象
	const hook = mountWorkInProgressHook();
	// 计算当前 useState 的 Hook 的最新值并赋值到 memoizedState 变量中
	let memoizedState;
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}
	// 创建对应的 updateQueue
	const queue = createUpdateQueue<State>();
	// 将 updateQueue 赋值到 Hook 实例对象中的 updateQueue
	hook.updateQueue = queue;
	// 更新当前 Hook 实例对象的最新值，也就是 memoizedState 属性
	hook.memoizedState = memoizedState;
	// 为了避免 baseState 为 null 值，所以将 memoizedState 也赋值到 baseState 中
	hook.baseState = memoizedState;

	// 构建对应的 dispatch 方法，并将其复制给 Hook 实例对象中的 dispatch 属性上
	// @ts-ignore
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
	queue.dispatch = dispatch;

	return [memoizedState, dispatch];
}

// 为 Hook 创建 update 对象，并将其放进 Hook 实例对象中的 updateQueue 属性上
function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	const lane = requestUpdateLane();
	// 创建 update 对象
	const update = createUpdate(action, lane);
	// 将新创建的 update 对象放到 updateQueue 中
	enqueueUpdate(updateQueue, update);
	// 从当前 fiberNode 开始调度更新
	scheduleUpdateOnFiber(fiber, lane);
}

// 在 mount 阶段创建 Hook 对象并形成 Hook 链表
function mountWorkInProgressHook(): Hook {
	// 构建一个 hook 实例对象
	const hook: Hook = {
		memoizedState: null,
		updateQueue: null,
		next: null,
		baseQueue: null,
		baseState: null
	};
	if (workInProgressHook === null) {
		// mount 时，第一个 hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用 hook');
		} else {
			// 将新建的 hook 赋值给变量 workInProgressHook 变量
			workInProgressHook = hook;
			// 将新建的 hook 实例对象赋值给 currentlyRenderingFiber.memoizedState
			// 由此可以，FunctionComponent 类型组件的 FiberNode 中的 memoizedState 属性存放着该 FunctionComponent 的第一个 hook 实例对象
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount 时，后续的 hook 将形成链表
		workInProgressHook.next = hook;
		workInProgressHook = hook;
	}
	// 返回最新的 Hook 实例对象
	return workInProgressHook;
}
