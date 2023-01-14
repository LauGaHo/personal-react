import internals from 'shared/internals';
import { FiberNode } from './fiber';

let currentlyRenderingFiber: FiberNode | null = null;
let workInProgressHook: Hook | null = null;

const { currentDispatcher } = internals;

interface Hook {
	memoizedState: any;
	updateQueue: unknown;
	next: Hook | null;
}

export function renderWithHooks(wip: FiberNode) {
	// 执行赋值操作
	currentlyRenderingFiber = wip;
	wip.memoizedState = null;

	const current = wip.alternate;

	if (current !== null) {
		// update
	} else {
		// mount
		// currentDispatcher.current = ;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	const children = Component(props);

	// 重置操作
	currentlyRenderingFiber = null;
	return children;
}
