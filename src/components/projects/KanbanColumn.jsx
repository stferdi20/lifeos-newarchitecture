import React from 'react';
import { Droppable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { ListTodo, Plus } from 'lucide-react';
import KanbanCard from './KanbanCard';

export default function KanbanColumn({ list, cards, projects, onAddCard, onEditCard }) {
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
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 flex flex-col rounded-xl p-2 min-h-[200px]',
              'transition-[background-color,box-shadow] duration-100',
              snapshot.isDraggingOver ? 'bg-blue-400/5 ring-2 ring-blue-400/40' : 'bg-secondary/10'
            )}
          >
            {cards.map((card, index) => (
              <KanbanCard
                key={card.id}
                task={card}
                projects={projects}
                onEdit={onEditCard}
                listId={list.id}
                index={index}
              />
            ))}
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
