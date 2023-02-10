// Copyright (C) 2022 Andrea Ballestrazzi

// Cards management
import 'cards-management/user-interface/add_card_button_event_handler.dart';
import 'cards-management/user-interface/add_card_button_event_handler_impl.dart';

import 'astali_injector.dart';

/// Represents the injector used inside the astali entry point.
class AstaliMainInjector implements AstaliInjector {
  const AstaliMainInjector();

  @override
  AddCardButtonEventHandler getAddCardButtonEventHandler() {
    return const AddCardButtonEventHandlerImpl();
  }
}
