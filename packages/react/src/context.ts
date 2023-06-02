import { ReactContext } from 'shared/ReactTypes';
import { REACT_CONTEXT_TYPE, REACT_PROVIDER_TYPE } from 'shared/ReactSymbols';

/**
 * 创建一个 ReactContext 实例对象
 * 改 API 一般都是给开发者调用生成 Context 对象
 * @param defaultValue {T} Context 的默认值
 * @template T
 */
export function createContext<T>(defaultValue: T): ReactContext<T> {
	const context: ReactContext<T> = {
		$$typeof: REACT_CONTEXT_TYPE,
		Provider: null,
		_currentValue: defaultValue
	};
	context.Provider = {
		$$typeof: REACT_PROVIDER_TYPE,
		_context: context
	};
	return context;
}
