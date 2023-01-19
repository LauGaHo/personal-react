import { ReactElementType } from 'shared/ReactTypes';
// @ts-ignore
import { createRoot } from 'react-dom';

export function renderIntoDocument(element: ReactElementType) {
	const div = document.createElement('div');
	// 返回值需要为 ReactElement 类型
	return createRoot(div).render(element);
}
