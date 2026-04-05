import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { ListTodo, Plus } from 'lucide-react';
import KanbanCard from './KanbanCard';

export default function KanbanColumn({ list, cards, projects, onAddCard, onEditCard }) {
  const columnRef = useRef(null);
  const rafRef = useRef(null);
  const [columnMetrics, setColumnMetrics] = useState({
    top: 0,
    viewportHeight: 0,
    scrollY: 0,
  });
  const estimatedCardHeight = 172;
  const overscanCards = 3;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateMetrics = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(() => {
        const rect = columnRef.current?.getBoundingClientRect();
        setColumnMetrics({
          top: rect ? rect.top + window.scrollY : 0,
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
        });
      });
    };

    updateMetrics();
    window.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    const resizeObserver = typeof ResizeObserver === 'function' && columnRef.current
      ? new ResizeObserver(() => updateMetrics())
      : null;

    if (resizeObserver && columnRef.current) {
      resizeObserver.observe(columnRef.current);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      window.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      resizeObserver?.disconnect();
    };
  }, [cards.length, list.id]);

  const visibleRange = useMemo(() => {
    if (!cards.length || !columnMetrics.viewportHeight) {
      const endIndex = Math.min(cards.length, 18);
      return {
        startIndex: 0,
        endIndex,
        topSpacerHeight: 0,
        bottomSpacerHeight: Math.max(0, (cards.length - endIndex) * estimatedCardHeight),
      };
    }

    const relativeTop = Math.max(0, columnMetrics.scrollY - columnMetrics.top);
    const relativeBottom = relativeTop + columnMetrics.viewportHeight;
    const startIndex = Math.max(0, Math.floor(relativeTop / estimatedCardHeight) - overscanCards);
    const endIndex = Math.min(cards.length, Math.ceil(relativeBottom / estimatedCardHeight) + overscanCards);

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * estimatedCardHeight,
      bottomSpacerHeight: Math.max(0, (cards.length - endIndex) * estimatedCardHeight),
    };
  }, [cards.length, columnMetrics.scrollY, columnMetrics.top, columnMetrics.viewportHeight]);

  const renderedCards = useMemo(
    () => cards.slice(visibleRange.startIndex, visibleRange.endIndex),
    [cards, visibleRange.endIndex, visibleRange.startIndex],
  );

  return (
    <div className="flex-1 min-w-[280px] max-w-[340px] flex flex-col">
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-3 border bg-secondary/30 border-border/50">
        <ListTodo className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-sm font-semibold truncate">{list.name}</span>
        <span className="text-xs text-muted-foreground ml-1 bg-secondary/50 px-1.5 py-0.5 rounded-full">
          {cards.length}
        </span>
      </div>

      <Droppable droppableId={list.id} type="CARD">
        {(provided, snapshot) => (
          <div
            ref={(node) => {
              columnRef.current = node;
              provided.innerRef(node);
            }}
            {...provided.droppableProps}
            className={cn(
              'flex-1 flex flex-col rounded-xl p-2 min-h-[200px]',
              'transition-[background-color,box-shadow] duration-100',
              snapshot.isDraggingOver ? 'bg-blue-400/5 ring-2 ring-blue-400/40' : 'bg-secondary/10'
            )}
          >
            {visibleRange.topSpacerHeight > 0 && (
              <div style={{ height: visibleRange.topSpacerHeight }} />
            )}

            {renderedCards.map((card, index) => (
              <KanbanCard
                key={card.id}
                task={card}
                projects={projects}
                onEdit={onEditCard}
                listId={list.id}
                index={visibleRange.startIndex + index}
              />
            ))}

            {visibleRange.bottomSpacerHeight > 0 && (
              <div style={{ height: visibleRange.bottomSpacerHeight }} />
            )}
            
            {provided.placeholder}

            {cards.length === 0 && !snapshot.isDraggingOver && (
              <div className="flex-1 flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground/40 text-center">Drop cards here</p>
              </div>
            )}
          </div>
        )}
      </Droppable>

      <button
        onClick={() => onAddCard(list.id)}
        className="mt-2 flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors w-full"
      >
        <Plus className="w-4 h-4" />
        Add a card
      </button>
    </div>
  );
}
