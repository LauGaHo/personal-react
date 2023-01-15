import { Dispatcher, Dispatch } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

// 当前正在 render 的 fiberNode
let currentlyRenderingFiber: FiberNode | null = null;
// 当前正在处理的 fiberNode 对应的 Hook 数据
let workInProgressHook: Hook | null = null;

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
export function renderWithHooks(wip: FiberNode) {
	// 执行赋值操作
	currentlyRenderingFiber = wip;
	// 重置操作
	wip.memoizedState = null;

	const current = wip.alternate;

	if (current !== null) {
		// update
	} else {
		// mount
		currentDispatcher.current = HooksDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	const children = Component(props);

	// 重置操作
	currentlyRenderingFiber = null;
	return children;
}

// mount 阶段对应的 HookDispatcher
const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState
};

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
	// 创建 update 对象
	const update = createUpdate(action);
	// 将新创建的 update 对象放到 updateQueue 中
	enqueueUpdate(updateQueue, update);
	// 从当前 fiberNode 开始调度更新
	scheduleUpdateOnFiber(fiber);
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
