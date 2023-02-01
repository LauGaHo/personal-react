import { Dispatcher, Dispatch } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
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
	memoizedState: any;
	updateQueue: unknown;
	next: Hook | null;
}

// render 阶段对函数组件中的 Hook 的处理
export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 执行赋值操作
	currentlyRenderingFiber = wip;
	// 重置操作，重置 hooks 链表
	wip.memoizedState = null;
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
	useState: mountState
};

// update 阶段对应的 HookDispatcher
const HookDispatcherOnUpdate: Dispatcher = {
	useState: updateState
};

// update 阶段 useState 对应的 Dispatch
function updateState<State>(): [State, Dispatch<State>] {
	// 为当前正在 mount 的 fiber 创建对应 Hook 链，并返回当前 Hook 实例对象
	const hook = updateWorkInProgressHook();

	// 计算当前 useState 的 Hook 的最新值并赋值到 memoizedState 变量中
	const queue = hook.updateQueue as UpdateQueue<State>;
	const pending = queue.shared.pending;

	if (pending !== null) {
		// 计算新值
		const { memoizedState } = processUpdateQueue(
			hook.memoizedState,
			pending,
			renderLane
		);
		// 并赋值到 hook 中的 memoizedState 变量上
		hook.memoizedState = memoizedState;
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
		next: null
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
	const hook: Hook = {
		memoizedState: null,
		updateQueue: null,
		next: null
	};
	if (workInProgressHook === null) {
		// mount 时，第一个 hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用 hook');
		} else {
			workInProgressHook = hook;
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
