// Copyright (C) 2022 Andrea Ballestrazzi

// Cards management
import 'cards-management/user-interface/add_card_button_event_handler.dart';

/// Represents an injector class that provides objects instances for the correct
/// execution of the main astali app.
abstract class AstaliInjector {
  /// Retrieves the event handler that is called when the
  /// "AddCard" button is called.
  AddCardButtonEventHandler getAddCardButtonEventHandler();
}
