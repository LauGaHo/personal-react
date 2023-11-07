import { FiberNode } from 'react-reconciler/src/fiber';
import { REACT_MEMO_TYPE } from 'shared/ReactSymbols';
import { Props } from 'shared/ReactTypes';

// React.memo(function App() {/*** ... ***/})
export function memo(
	type: FiberNode['type'],
	compare?: (oldProps: Props, newProps: Props) => boolean
) {
	const fiberType = {
		$$typeof: REACT_MEMO_TYPE,
		// 需要包装的 FunctionComponent
		type,
		compare: compare === undefined ? null : compare
	};
	return fiberType;
}
