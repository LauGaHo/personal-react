// React

import { Dispatcher, resolveDispatcher } from './src/currentDispatcher';
import currentDispatcher from './src/currentDispatcher';
import currentBatchConfig from './src/currentBatchConfig';
import { jsx, jsxDEV, isValidElement as isValidElementFn } from './src/jsx';
import { ReactContext } from 'shared/ReactTypes';
export {
	REACT_FRAGMENT_TYPE as Fragment,
	REACT_SUSPENSE_TYPE as Suspense
} from 'shared/ReactSymbols';
export { createContext } from './src/context';

export const useState: Dispatcher['useState'] = (initialState) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useState(initialState);
};

export const useEffect: Dispatcher['useEffect'] = (create, deps) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useEffect(create, deps);
};

export const useTransition: Dispatcher['useTransition'] = () => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useTransition();
};

export const useRef: Dispatcher['useRef'] = (initialValue) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useRef(initialValue);
};

export const useContext: Dispatcher['useContext'] = <T>(
	context: ReactContext<T>
) => {
	const dispatcher = resolveDispatcher();
	return dispatcher.useContext(context);
};

// 内部数据共享层
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
	currentDispatcher,
	currentBatchConfig
};

export const version = '0.0.0';

// TODO 根据环境区分使用 jsx 还是 jsxDEV
export const createElement = jsx;

export const isValidElement = isValidElementFn;
