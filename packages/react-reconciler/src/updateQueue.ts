import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Update } from './fiberFlags';

// 定义 Update
export interface Update<State> {
	action: Action<State>;
	next: Update<any> | null;
}

// 定义 UpdateQueue
export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: Dispatch<State> | null;
}

// 创建 Update 对象
export const createUpdate = <State>(action: Action<State>): Update<State> => {
	return {
		action,
		next: null
	};
};

// 创建 UpdateQueue
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		},
		dispatch: null
	} as UpdateQueue<State>;
};

// 将 Update 实例对象放进 updateQueue 中
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
) => {
	updateQueue.shared.pending = update;

	const pending = updateQueue.shared.pending;
	if (pending === null) {
		// 如果当前 pending 为空，说明当前的 updateQueue 为空，所以将传进来的 update 对象的 next 指针指向它自己
		// pending -> a -> a
		// pending 指向的是这个链表最新插入的 update
		update.next = update;
	} else {
		// pending = b -> a -> b
		// pending = c -> a -> b -> c
		// 所以由上可知，pending 指向最新插入的 update，pending.next 指向第一个插入的 update
		update.next = pending.next;
		pending.next = update;
	}
	updateQueue.shared.pending = update;
};

// 实现 baseState 和 Update 对象进行比对，得出最新的 memoizedState
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null
): { memoizedState: State } => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState
	};

	if (pendingUpdate !== null) {
		const action = pendingUpdate.action;
		if (action instanceof Function) {
			// baseState = 1; update = (x) => 4x; => memoizedState = 4
			result.memoizedState = action(baseState);
		} else {
			// baseState = 1; update = 2; => memoizedState = 2
			result.memoizedState = action;
		}
	}

	return result;
};
